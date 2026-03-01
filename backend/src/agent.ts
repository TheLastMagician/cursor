import Anthropic from '@anthropic-ai/sdk';
import { AgentEvent, ToolResult } from './types.js';
import { toolDefinitions, executeTool } from './tools.js';

const SYSTEM_PROMPT = `You are an autonomous coding agent running in a cloud sandbox environment. You can execute shell commands, read and write files, search codebases, and perform complex multi-step software engineering tasks.

Your capabilities:
- Execute any shell command (install packages, run scripts, git operations, etc.)
- Read and write files in the workspace
- Search code using ripgrep
- List directory contents

Your workflow:
1. Understand the user's task
2. Explore the workspace to understand the current state
3. Plan your approach
4. Execute step by step, verifying each step
5. Report results with clear evidence

Rules:
- Always verify your changes work by running the code
- Be thorough and systematic
- If something fails, debug and retry
- Provide clear explanations of what you did and why`;

const MAX_ITERATIONS = 30;

type EmitFn = (event: AgentEvent) => void;

function ts(): string {
  return new Date().toISOString();
}

export async function runAgent(
  prompt: string,
  workspace: string,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    await runMockAgent(prompt, workspace, emit);
    return;
  }

  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ];

  const tools: Anthropic.Tool[] = toolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) {
      emit({ type: 'error', content: 'Task cancelled', timestamp: ts() });
      return;
    }

    emit({ type: 'thinking', content: `Iteration ${i + 1}/${MAX_ITERATIONS}...`, timestamp: ts() });

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });
    } catch (err) {
      emit({ type: 'error', content: `LLM API error: ${err instanceof Error ? err.message : String(err)}`, timestamp: ts() });
      return;
    }

    let hasToolUse = false;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        emit({ type: 'message', content: block.text, timestamp: ts() });
      } else if (block.type === 'tool_use') {
        hasToolUse = true;
        const toolInput = block.input as Record<string, unknown>;

        emit({
          type: 'tool_call',
          id: block.id,
          tool: block.name,
          input: toolInput,
          timestamp: ts(),
        });

        let result: ToolResult;
        try {
          result = executeTool(block.name, toolInput, workspace);
        } catch (err) {
          result = { output: `Execution error: ${err instanceof Error ? err.message : String(err)}`, success: false };
        }

        emit({
          type: 'tool_result',
          id: block.id,
          output: result.output,
          success: result.success,
          timestamp: ts(),
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.output,
          is_error: !result.success,
        });
      }
    }

    messages.push({ role: 'assistant', content: response.content });

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
    }

    if (response.stop_reason === 'end_turn' || !hasToolUse) {
      break;
    }
  }
}

async function runMockAgent(prompt: string, workspace: string, emit: EmitFn): Promise<void> {
  emit({ type: 'thinking', content: 'Analyzing task... (Mock Mode — set ANTHROPIC_API_KEY for real agent)', timestamp: ts() });
  await sleep(800);

  emit({ type: 'message', content: `I understand your request: "${prompt}". Let me explore the workspace first.`, timestamp: ts() });
  await sleep(500);

  const listResult = executeTool('list_files', { depth: 2 }, workspace);
  emit({ type: 'tool_call', id: 'mock-1', tool: 'list_files', input: { depth: 2 }, timestamp: ts() });
  await sleep(300);
  emit({ type: 'tool_result', id: 'mock-1', output: listResult.output, success: listResult.success, timestamp: ts() });
  await sleep(500);

  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('hello') || lowerPrompt.includes('create') || lowerPrompt.includes('write') || lowerPrompt.includes('文件') || lowerPrompt.includes('创建')) {
    emit({ type: 'message', content: 'I\'ll create the requested file for you.', timestamp: ts() });
    await sleep(400);

    const fileName = 'hello.py';
    const fileContent = '#!/usr/bin/env python3\n"""Hello World - Created by Agent Cloud"""\n\ndef main():\n    print("Hello, World! 🚀")\n    print("This file was created by Agent Cloud")\n\nif __name__ == "__main__":\n    main()\n';

    const writeResult = executeTool('write_file', { path: fileName, content: fileContent }, workspace);
    emit({ type: 'tool_call', id: 'mock-2', tool: 'write_file', input: { path: fileName, content: fileContent }, timestamp: ts() });
    await sleep(300);
    emit({ type: 'tool_result', id: 'mock-2', output: writeResult.output, success: writeResult.success, timestamp: ts() });
    await sleep(500);

    emit({ type: 'message', content: 'Now let me verify by running the file.', timestamp: ts() });
    await sleep(400);

    const runResult = executeTool('shell', { command: `python3 ${fileName}` }, workspace);
    emit({ type: 'tool_call', id: 'mock-3', tool: 'shell', input: { command: `python3 ${fileName}` }, timestamp: ts() });
    await sleep(300);
    emit({ type: 'tool_result', id: 'mock-3', output: runResult.output, success: runResult.success, timestamp: ts() });
    await sleep(500);

    const readResult = executeTool('read_file', { path: fileName }, workspace);
    emit({ type: 'tool_call', id: 'mock-4', tool: 'read_file', input: { path: fileName }, timestamp: ts() });
    await sleep(300);
    emit({ type: 'tool_result', id: 'mock-4', output: readResult.output, success: readResult.success, timestamp: ts() });
    await sleep(400);

    emit({ type: 'message', content: `Done! I've created \`${fileName}\` and verified it runs correctly. The file prints "Hello, World! 🚀" as expected.`, timestamp: ts() });
  } else {
    emit({ type: 'message', content: 'Let me search the codebase for relevant code.', timestamp: ts() });
    await sleep(400);

    const searchResult = executeTool('search', { pattern: '.', path: '.' }, workspace);
    emit({ type: 'tool_call', id: 'mock-2', tool: 'search', input: { pattern: 'function|class|def', glob: '*.{ts,js,py}' }, timestamp: ts() });
    await sleep(300);
    emit({ type: 'tool_result', id: 'mock-2', output: searchResult.output || 'No matching files found in workspace.', success: true, timestamp: ts() });
    await sleep(500);

    emit({
      type: 'message',
      content: `I've analyzed the workspace. Here's what I found:\n\n${listResult.output ? '**Files:**\n```\n' + listResult.output + '\n```' : 'The workspace is empty.'}\n\nTo proceed with your task, please provide the ANTHROPIC_API_KEY environment variable for full agent capabilities. In mock mode, I can demonstrate basic tool operations like creating files and running commands.`,
      timestamp: ts(),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
