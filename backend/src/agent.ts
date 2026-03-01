import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AgentEvent, ToolResult } from './types.js';
import { toolDefinitions, executeTool } from './tools.js';

const SYSTEM_PROMPT = `You are an autonomous coding agent running in a cloud sandbox environment. You help users with software engineering tasks by writing code, running commands, and managing files.

Your capabilities:
- Execute shell commands (install packages, run scripts, git operations, etc.)
- Read and write files in the workspace
- Search code using ripgrep
- List directory contents

Your workflow:
1. Understand the user's task
2. Explore the workspace to understand the current state
3. Plan your approach  
4. Execute step by step, verifying each step
5. Report results with clear evidence

CRITICAL TESTING RULES:
- After writing code, you MUST run it to verify it works
- After running code, analyze the output and report test results clearly
- Use a structured "Testing" section at the end with checkmarks:
  ✅ for passed tests
  ❌ for failed tests
- If a test fails, debug and fix the code, then re-run
- Always show the actual output of running the code as evidence
- For web applications, provide the URL and describe how to test manually
- End your response with a "Summary" section listing what was done and test results

FORMATTING RULES:
- Use markdown formatting (headers, code blocks, bullet points, tables)
- Use \`\`\`python or \`\`\`javascript for code blocks with language tags
- Respond in the same language as the user's request`;

const MAX_ITERATIONS = 30;

type EmitFn = (event: AgentEvent) => void;

function ts(): string {
  return new Date().toISOString();
}

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

export async function runAgent(
  prompt: string,
  workspace: string,
  emit: EmitFn,
  signal?: AbortSignal,
  existingMessages?: OpenAI.ChatCompletionMessageParam[],
): Promise<OpenAI.ChatCompletionMessageParam[]> {
  const provider = detectProvider();

  switch (provider) {
    case 'minimax':
      return await runOpenAICompatibleAgent(prompt, workspace, emit, signal, existingMessages);
    case 'anthropic':
      await runAnthropicAgent(prompt, workspace, emit, signal);
      return [];
    default:
      await runMockAgent(prompt, workspace, emit);
      return [];
  }
}

const openaiTools: OpenAI.ChatCompletionTool[] = toolDefinitions.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
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

  const messages: OpenAI.ChatCompletionMessageParam[] = existingMessages
    ? [...existingMessages, { role: 'user' as const, content: prompt }]
    : [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        { role: 'user' as const, content: prompt },
      ];

  const startTime = Date.now();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) {
      emit({ type: 'error', content: 'Task cancelled', timestamp: ts() });
      return messages;
    }

    const thinkStart = Date.now();
    emit({ type: 'thinking', content: `Thinking...`, timestamp: ts() });

    let response: OpenAI.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: 'MiniMax-M2.5',
        max_tokens: 8192,
        messages,
        tools: openaiTools,
        tool_choice: 'auto',
      });
    } catch (err) {
      const thinkDuration = Math.round((Date.now() - thinkStart) / 1000);
      emit({ type: 'thinking_done', duration: thinkDuration, timestamp: ts() });
      emit({ type: 'error', content: `LLM API error: ${err instanceof Error ? err.message : String(err)}`, timestamp: ts() });
      return messages;
    }

    const thinkDuration = Math.round((Date.now() - thinkStart) / 1000);
    emit({ type: 'thinking_done', duration: thinkDuration, timestamp: ts() });

    const choice = response.choices[0];
    if (!choice) {
      emit({ type: 'error', content: 'No response from LLM', timestamp: ts() });
      return messages;
    }

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
        try {
          parsedInput = JSON.parse(fn.arguments);
        } catch {
          parsedInput = { raw: fn.arguments };
        }

        emit({
          type: 'tool_call',
          id: toolCall.id,
          tool: fn.name,
          input: parsedInput,
          timestamp: ts(),
        });

        let result: ToolResult;
        try {
          result = executeTool(fn.name, parsedInput, workspace);
        } catch (err) {
          result = { output: `Execution error: ${err instanceof Error ? err.message : String(err)}`, success: false };
        }

        emit({
          type: 'tool_result',
          id: toolCall.id,
          output: result.output,
          success: result.success,
          timestamp: ts(),
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result.output,
        });
      }
    }

    if (choice.finish_reason === 'stop' || !assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }
  }

  return messages;
}

async function runAnthropicAgent(
  prompt: string,
  workspace: string,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  const tools: Anthropic.Tool[] = toolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) { emit({ type: 'error', content: 'Task cancelled', timestamp: ts() }); return; }
    const thinkStart = Date.now();
    emit({ type: 'thinking', content: 'Thinking...', timestamp: ts() });

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 8192, system: SYSTEM_PROMPT, tools, messages });
    } catch (err) {
      emit({ type: 'thinking_done', duration: Math.round((Date.now() - thinkStart) / 1000), timestamp: ts() });
      emit({ type: 'error', content: `LLM API error: ${err instanceof Error ? err.message : String(err)}`, timestamp: ts() }); return;
    }
    emit({ type: 'thinking_done', duration: Math.round((Date.now() - thinkStart) / 1000), timestamp: ts() });

    let hasToolUse = false;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        emit({ type: 'message', content: block.text, timestamp: ts() });
      } else if (block.type === 'tool_use') {
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

async function runMockAgent(prompt: string, workspace: string, emit: EmitFn): Promise<void> {
  const start = Date.now();
  emit({ type: 'thinking', content: 'Thinking...', timestamp: ts() });
  await sleep(800);
  emit({ type: 'thinking_done', duration: 1, timestamp: ts() });

  emit({ type: 'message', content: `I'll help you with: "${prompt}". Let me explore the workspace first.`, timestamp: ts() });
  await sleep(400);

  const listResult = executeTool('list_files', { depth: 2 }, workspace);
  emit({ type: 'tool_call', id: 'mock-1', tool: 'list_files', input: { depth: 2 }, timestamp: ts() });
  await sleep(300);
  emit({ type: 'tool_result', id: 'mock-1', output: listResult.output, success: listResult.success, timestamp: ts() });
  await sleep(400);

  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('hello') || lowerPrompt.includes('create') || lowerPrompt.includes('write') || lowerPrompt.includes('文件') || lowerPrompt.includes('创建')) {
    emit({ type: 'message', content: 'I\'ll create a Python script for you.', timestamp: ts() });
    await sleep(300);
    const fileName = 'hello.py';
    const fileContent = '#!/usr/bin/env python3\n"""Hello World - Created by Agent Cloud"""\n\ndef main():\n    print("Hello, World!")\n    print("Created by Agent Cloud")\n\nif __name__ == "__main__":\n    main()\n';
    const writeResult = executeTool('write_file', { path: fileName, content: fileContent }, workspace);
    emit({ type: 'tool_call', id: 'mock-2', tool: 'write_file', input: { path: fileName, content: fileContent }, timestamp: ts() });
    await sleep(200);
    emit({ type: 'tool_result', id: 'mock-2', output: writeResult.output, success: writeResult.success, timestamp: ts() });
    await sleep(300);
    const runResult = executeTool('shell', { command: `python3 ${fileName}` }, workspace);
    emit({ type: 'tool_call', id: 'mock-3', tool: 'shell', input: { command: `python3 ${fileName}` }, timestamp: ts() });
    await sleep(200);
    emit({ type: 'tool_result', id: 'mock-3', output: runResult.output, success: runResult.success, timestamp: ts() });
    await sleep(300);
    const dur = Math.round((Date.now() - start) / 1000);
    emit({ type: 'message', content: `## Summary\n\n- Created \`${fileName}\` with a hello world script\n- Verified it runs correctly\n\n**Testing**\n- ✅ \`python3 hello.py\` — output matches expected\n\nWorked for ${dur}s`, timestamp: ts() });
  } else {
    emit({ type: 'message', content: `Workspace explored. Set \`MINIMAX_API_KEY\` or \`ANTHROPIC_API_KEY\` for full agent capabilities.`, timestamp: ts() });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
