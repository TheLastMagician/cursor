import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { AgentEvent, ToolResult } from './types.js';
import { toolDefinitions, executeTool } from './tools.js';

// ─── System Prompt (hierarchical, matching design doc §3.3.2) ───────────────

function buildSystemPrompt(workspace: string): string {
  const sections: string[] = [];

  // §1 Identity
  sections.push(`<identity>
You are an autonomous coding agent running in a cloud sandbox. You perform complex multi-step software engineering tasks: writing code, running commands, debugging, testing, and deploying.
</identity>`);

  // §2 Tools
  sections.push(`<tools>
You have access to these tools: ${toolDefinitions.map(t => t.name).join(', ')}.
Key tool rules:
- Shell is STATEFUL: cwd and env persist across calls. Use 'cd' to navigate.
- Use str_replace for editing existing files (NOT write_file, which overwrites entirely).
- Use glob to find files by pattern. Use search (ripgrep) to find content.
- Use todo_write for complex multi-step tasks to track progress.
- Always quote file paths with spaces.
</tools>`);

  // §3 Workflow
  sections.push(`<workflow>
1. EXPLORE: Understand the workspace (list_files, read_file, search)
2. PLAN: Create a todo list for complex tasks (todo_write)
3. IMPLEMENT: Write/edit code (write_file, str_replace)
4. TEST: Always run code to verify (shell). Never skip this step.
5. DEBUG: If tests fail, read error output, fix, and re-test.
6. REPORT: Summarize what was done with evidence.
</workflow>`);

  // §4 Testing methodology (design doc §4.3)
  sections.push(`<testing>
CRITICAL TESTING RULES:
- After writing code, you MUST run it to verify correctness.
- After running, analyze output and report structured test results:
  ✅ for passed tests
  ❌ for failed tests
- If a test fails, debug and fix the code, then re-run.
- Show actual command output as evidence.
- End with a Summary section listing changes and test results.
- For web apps: start the server, test with curl, and report URLs.
</testing>`);

  // §5 Code editing rules
  sections.push(`<editing>
- Use str_replace for surgical edits (safer than rewriting entire files).
- Read the file first before editing to understand context.
- Preserve exact indentation and whitespace.
- Do NOT add unnecessary comments explaining obvious changes.
</editing>`);

  // §6 Git integration
  sections.push(`<git>
- If the workspace is a git repo, commit your changes when the task is complete.
- Use descriptive commit messages.
- Run: git add -A && git commit -m "description of changes"
</git>`);

  // §7 Formatting
  sections.push(`<formatting>
- Use markdown in responses (headers, code blocks, bullet points, tables).
- Use language-tagged code blocks (\`\`\`python, \`\`\`javascript, etc.).
- Respond in the same language as the user's request.
</formatting>`);

  // §8 AGENTS.md (persistent knowledge, design doc §3.9)
  const agentsMdPath = join(workspace, 'AGENTS.md');
  if (existsSync(agentsMdPath)) {
    try {
      const agentsMd = readFileSync(agentsMdPath, 'utf-8').slice(0, 4000);
      sections.push(`<agents_md>
The following is the AGENTS.md file from the workspace. It contains important project-specific instructions. Follow these guidelines:
${agentsMd}
</agents_md>`);
    } catch { /* ignore read errors */ }
  }

  return sections.join('\n\n');
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 50;

type EmitFn = (event: AgentEvent) => void;
function ts(): string { return new Date().toISOString(); }

type LLMProvider = 'minimax' | 'anthropic' | 'mock';

function detectProvider(): LLMProvider {
  if (process.env.MINIMAX_API_KEY) return 'minimax';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'mock';
}

export function getProviderInfo(): { provider: LLMProvider; model: string } {
  const provider = detectProvider();
  switch (provider) {
    case 'minimax': return { provider, model: 'MiniMax-M2.5' };
    case 'anthropic': return { provider, model: 'claude-sonnet-4-20250514' };
    default: return { provider: 'mock', model: 'mock-agent' };
  }
}

// ─── Git Integration ────────────────────────────────────────────────────────

function tryGitCommit(workspace: string, summary: string): string | null {
  try {
    const isGit = existsSync(join(workspace, '.git'));
    if (!isGit) return null;

    const status = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8' }).trim();
    if (!status) return null;

    const changedFiles = status.split('\n').length;
    const msg = summary.slice(0, 72) || 'Agent task completed';
    execSync(`git add -A && git commit -m "${msg.replace(/"/g, '\\"')}"`, {
      cwd: workspace, encoding: 'utf-8', timeout: 15000,
    });
    return `Committed ${changedFiles} file(s): ${msg}`;
  } catch {
    return null;
  }
}

// ─── Main Entry ─────────────────────────────────────────────────────────────

export async function runAgent(
  prompt: string,
  workspace: string,
  emit: EmitFn,
  signal?: AbortSignal,
  existingMessages?: OpenAI.ChatCompletionMessageParam[],
): Promise<OpenAI.ChatCompletionMessageParam[]> {
  const provider = detectProvider();

  let messages: OpenAI.ChatCompletionMessageParam[];
  switch (provider) {
    case 'minimax':
      messages = await runOpenAICompatibleAgent(prompt, workspace, emit, signal, existingMessages);
      break;
    case 'anthropic':
      await runAnthropicAgent(prompt, workspace, emit, signal);
      messages = [];
      break;
    default:
      await runMockAgent(prompt, workspace, emit);
      messages = [];
      break;
  }

  // Git auto-commit
  const lastMessage = messages.length > 0 ?
    messages.filter(m => m.role === 'assistant').pop() : null;
  const summary = lastMessage && typeof lastMessage.content === 'string'
    ? lastMessage.content.slice(0, 100) : 'Agent completed task';
  const commitResult = tryGitCommit(workspace, summary);
  if (commitResult) {
    emit({ type: 'message', content: `📦 ${commitResult}`, timestamp: ts() });
  }

  return messages;
}

// ─── OpenAI-Compatible Agent (MiniMax) ──────────────────────────────────────

const openaiTools: OpenAI.ChatCompletionTool[] = toolDefinitions.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

async function runOpenAICompatibleAgent(
  prompt: string,
  workspace: string,
  emit: EmitFn,
  signal?: AbortSignal,
  existingMessages?: OpenAI.ChatCompletionMessageParam[],
): Promise<OpenAI.ChatCompletionMessageParam[]> {
  const client = new OpenAI({
    apiKey: process.env.MINIMAX_API_KEY,
    baseURL: 'https://api.minimaxi.com/v1',
  });

  const systemPrompt = buildSystemPrompt(workspace);

  const messages: OpenAI.ChatCompletionMessageParam[] = existingMessages
    ? [...existingMessages, { role: 'user' as const, content: prompt }]
    : [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: prompt },
      ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) { emit({ type: 'error', content: 'Task cancelled', timestamp: ts() }); return messages; }

    const thinkStart = Date.now();
    emit({ type: 'thinking', content: 'Thinking...', timestamp: ts() });

    let response: OpenAI.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: 'MiniMax-M2.5',
        max_tokens: 16384,
        messages,
        tools: openaiTools,
        tool_choice: 'auto',
      });
    } catch (err) {
      emit({ type: 'thinking_done', duration: Math.round((Date.now() - thinkStart) / 1000), timestamp: ts() });
      emit({ type: 'error', content: `LLM API error: ${err instanceof Error ? err.message : String(err)}`, timestamp: ts() });
      return messages;
    }
    emit({ type: 'thinking_done', duration: Math.round((Date.now() - thinkStart) / 1000), timestamp: ts() });

    const choice = response.choices[0];
    if (!choice) { emit({ type: 'error', content: 'No response from LLM', timestamp: ts() }); return messages; }

    const assistantMessage = choice.message;
    if (assistantMessage.content) {
      emit({ type: 'message', content: assistantMessage.content, timestamp: ts() });
    }
    messages.push(assistantMessage);

    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const fn = toolCall.function;
        let parsedInput: Record<string, unknown>;
        try { parsedInput = JSON.parse(fn.arguments); }
        catch { parsedInput = { raw: fn.arguments }; }

        emit({ type: 'tool_call', id: toolCall.id, tool: fn.name, input: parsedInput, timestamp: ts() });

        let result: ToolResult;
        try { result = executeTool(fn.name, parsedInput, workspace); }
        catch (err) { result = { output: `Error: ${err instanceof Error ? err.message : String(err)}`, success: false }; }

        emit({ type: 'tool_result', id: toolCall.id, output: result.output, success: result.success, timestamp: ts() });
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result.output });
      }
    }

    if (choice.finish_reason === 'stop' || !assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) break;
  }

  return messages;
}

// ─── Anthropic Agent ────────────────────────────────────────────────────────

async function runAnthropicAgent(prompt: string, workspace: string, emit: EmitFn, signal?: AbortSignal): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = buildSystemPrompt(workspace);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  const tools: Anthropic.Tool[] = toolDefinitions.map((t) => ({
    name: t.name, description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) { emit({ type: 'error', content: 'Task cancelled', timestamp: ts() }); return; }
    const thinkStart = Date.now();
    emit({ type: 'thinking', content: 'Thinking...', timestamp: ts() });

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 16384, system: systemPrompt, tools, messages });
    } catch (err) {
      emit({ type: 'thinking_done', duration: Math.round((Date.now() - thinkStart) / 1000), timestamp: ts() });
      emit({ type: 'error', content: `LLM API error: ${err instanceof Error ? err.message : String(err)}`, timestamp: ts() }); return;
    }
    emit({ type: 'thinking_done', duration: Math.round((Date.now() - thinkStart) / 1000), timestamp: ts() });

    let hasToolUse = false;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) emit({ type: 'message', content: block.text, timestamp: ts() });
      else if (block.type === 'tool_use') {
        hasToolUse = true;
        const toolInput = block.input as Record<string, unknown>;
        emit({ type: 'tool_call', id: block.id, tool: block.name, input: toolInput, timestamp: ts() });
        let result: ToolResult;
        try { result = executeTool(block.name, toolInput, workspace); }
        catch (err) { result = { output: `Error: ${err instanceof Error ? err.message : String(err)}`, success: false }; }
        emit({ type: 'tool_result', id: block.id, output: result.output, success: result.success, timestamp: ts() });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.output, is_error: !result.success });
      }
    }
    messages.push({ role: 'assistant', content: response.content });
    if (toolResults.length > 0) messages.push({ role: 'user', content: toolResults });
    if (response.stop_reason === 'end_turn' || !hasToolUse) break;
  }
}

// ─── Mock Agent ─────────────────────────────────────────────────────────────

async function runMockAgent(prompt: string, workspace: string, emit: EmitFn): Promise<void> {
  emit({ type: 'thinking', content: 'Thinking...', timestamp: ts() });
  await sleep(600);
  emit({ type: 'thinking_done', duration: 1, timestamp: ts() });
  emit({ type: 'message', content: `I'll help you with: "${prompt}". Let me explore the workspace.`, timestamp: ts() });

  const listResult = executeTool('list_files', { depth: 2 }, workspace);
  emit({ type: 'tool_call', id: 'mock-1', tool: 'list_files', input: { depth: 2 }, timestamp: ts() });
  await sleep(200);
  emit({ type: 'tool_result', id: 'mock-1', output: listResult.output, success: listResult.success, timestamp: ts() });

  emit({ type: 'message', content: `Set \`MINIMAX_API_KEY\` or \`ANTHROPIC_API_KEY\` for full autonomous agent capabilities.\n\n**Mock mode** can only demonstrate tool calling.`, timestamp: ts() });
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
