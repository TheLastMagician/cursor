import { execSync, spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { ToolDefinition, ToolResult } from './types.js';

// ─── Stateful Shell Sessions ────────────────────────────────────────────────
interface ShellSession {
  cwd: string;
  env: Record<string, string>;
}

const sessions = new Map<string, ShellSession>();

function getSession(workspace: string): ShellSession {
  let session = sessions.get(workspace);
  if (!session) {
    session = { cwd: workspace, env: { ...process.env as Record<string, string> } };
    sessions.set(workspace, session);
  }
  return session;
}

export function setWorkspaceEnv(workspace: string, key: string, value: string): void {
  const session = getSession(workspace);
  session.env[key] = value;
}

// ─── Tool Definitions ───────────────────────────────────────────────────────
export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'shell',
    description: 'Execute a shell command. The shell is stateful: cwd and env vars persist across calls. Use working_directory to run in a specific directory.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        working_directory: { type: 'string', description: 'Directory to run command in (relative to workspace). If omitted, uses the current session cwd.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds. Default 30000 (30s).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns line-numbered content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (relative to workspace or absolute)' },
        offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file and parent directories if they do not exist. Overwrites existing content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (relative to workspace)' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'str_replace',
    description: 'Perform exact string replacement in a file. The old_string must be unique in the file (or use replace_all). Preserves indentation.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (relative to workspace)' },
        old_string: { type: 'string', description: 'The exact text to replace (must be unique in the file unless replace_all is true)' },
        new_string: { type: 'string', description: 'The replacement text' },
        replace_all: { type: 'boolean', description: 'If true, replaces all occurrences. Default false.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file at the specified path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete (relative to workspace)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'glob',
    description: 'Search for files matching a glob pattern. Returns matching file paths sorted by modification time.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "*.ts", "src/**/*.tsx"). Patterns not starting with **/ are auto-prepended.' },
        path: { type: 'string', description: 'Directory to search in (relative to workspace). Default: workspace root.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'search',
    description: 'Search for a pattern in files using ripgrep. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search in. Default: workspace root.' },
        glob: { type: 'string', description: 'File glob filter, e.g. "*.ts"' },
        context: { type: 'number', description: 'Lines of context before and after each match (-C). Default 0.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories. Returns a tree-like listing.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Default: workspace root.' },
        depth: { type: 'number', description: 'Max recursion depth. Default 2.' },
      },
      required: [],
    },
  },
  {
    name: 'todo_write',
    description: 'Create or update a structured task list to track progress on complex tasks. Use for tasks with 3+ steps.',
    input_schema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Array of todo items',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier' },
              content: { type: 'string', description: 'Task description' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Task status' },
            },
            required: ['id', 'content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
];

// ─── Path Safety ────────────────────────────────────────────────────────────
function safePath(workspace: string, relativePath: string): string {
  const resolved = resolve(workspace, relativePath);
  if (!resolved.startsWith(resolve(workspace))) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  return resolved;
}

// ─── Tree Listing ───────────────────────────────────────────────────────────
function listDir(dirPath: string, prefix: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];
  const lines: string[] = [];
  try {
    const entries = readdirSync(dirPath).filter(e => !e.startsWith('.'));
    entries.sort();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const fullPath = join(dirPath, entry);
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          lines.push(`${prefix}${connector}${entry}/`);
          lines.push(...listDir(fullPath, prefix + (isLast ? '    ' : '│   '), depth + 1, maxDepth));
        } else {
          const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
          lines.push(`${prefix}${connector}${entry} (${size})`);
        }
      } catch {
        lines.push(`${prefix}${connector}${entry} [permission denied]`);
      }
    }
  } catch { lines.push(`${prefix}[cannot read directory]`); }
  return lines;
}

// ─── Tool Executor ──────────────────────────────────────────────────────────
export function executeTool(name: string, input: Record<string, unknown>, workspace: string): ToolResult {
  try {
    switch (name) {
      case 'shell': {
        const command = input.command as string;
        const session = getSession(workspace);
        const timeout = (input.timeout as number) || 30000;

        if (input.working_directory) {
          session.cwd = safePath(workspace, input.working_directory as string);
        }

        // Handle cd commands to update session cwd
        const cdMatch = command.match(/^cd\s+(.+)$/);
        if (cdMatch) {
          const target = cdMatch[1].replace(/^["']|["']$/g, '');
          const newCwd = resolve(session.cwd, target);
          if (existsSync(newCwd)) {
            session.cwd = newCwd;
            return { output: `Changed directory to ${newCwd}`, success: true };
          }
          return { output: `Directory not found: ${newCwd}`, success: false };
        }

        try {
          const stdout = execSync(command, {
            cwd: session.cwd,
            timeout,
            maxBuffer: 2 * 1024 * 1024,
            encoding: 'utf-8',
            env: session.env,
          });

          // Track cwd changes from compound commands
          try {
            const pwdOut = execSync('pwd', { cwd: session.cwd, encoding: 'utf-8', env: session.env }).trim();
            session.cwd = pwdOut;
          } catch { /* ignore */ }

          return { output: `$ ${command}\n${stdout}`.slice(0, 50000), success: true };
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; status?: number };
          const output = [`$ ${command}`, e.stdout || '', e.stderr || '', `Exit code: ${e.status ?? 1}`]
            .filter(Boolean).join('\n').slice(0, 50000);
          return { output, success: false };
        }
      }

      case 'read_file': {
        const filePath = safePath(workspace, input.path as string);
        if (!existsSync(filePath)) return { output: `File not found: ${input.path}`, success: false };
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const offset = ((input.offset as number) || 1) - 1;
        const limit = (input.limit as number) || lines.length;
        const slice = lines.slice(offset, offset + limit);
        const numbered = slice.map((line, i) => `${String(offset + i + 1).padStart(4)}│ ${line}`);
        return { output: numbered.join('\n'), success: true };
      }

      case 'write_file': {
        const filePath = safePath(workspace, input.path as string);
        const dir = dirname(filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, input.content as string, 'utf-8');
        return { output: `Written to ${input.path} (${(input.content as string).length} bytes)`, success: true };
      }

      case 'str_replace': {
        const filePath = safePath(workspace, input.path as string);
        if (!existsSync(filePath)) return { output: `File not found: ${input.path}`, success: false };
        let content = readFileSync(filePath, 'utf-8');
        const oldStr = input.old_string as string;
        const newStr = input.new_string as string;
        const replaceAll = input.replace_all as boolean;

        if (!content.includes(oldStr)) {
          return { output: `old_string not found in ${input.path}. Make sure it matches exactly (including whitespace/indentation).`, success: false };
        }

        if (!replaceAll) {
          const count = content.split(oldStr).length - 1;
          if (count > 1) {
            return { output: `old_string found ${count} times in ${input.path}. Provide more context to make it unique, or set replace_all: true.`, success: false };
          }
          content = content.replace(oldStr, newStr);
        } else {
          content = content.split(oldStr).join(newStr);
        }

        writeFileSync(filePath, content, 'utf-8');
        return { output: `Replaced in ${input.path}`, success: true };
      }

      case 'delete_file': {
        const filePath = safePath(workspace, input.path as string);
        if (!existsSync(filePath)) return { output: `File not found: ${input.path}`, success: false };
        unlinkSync(filePath);
        return { output: `Deleted ${input.path}`, success: true };
      }

      case 'glob': {
        let pattern = input.pattern as string;
        if (!pattern.startsWith('**/')) pattern = `**/${pattern}`;
        const searchDir = input.path ? safePath(workspace, input.path as string) : workspace;
        try {
          const result = execSync(
            `find "${searchDir}" -path '*/node_modules' -prune -o -path '*/.git' -prune -o -name "${pattern.replace('**/', '')}" -print | head -50`,
            { encoding: 'utf-8', timeout: 10000 }
          ).trim();
          if (!result) return { output: 'No files found.', success: true };
          const relative = result.split('\n').map(p => p.replace(workspace + '/', '')).join('\n');
          return { output: relative, success: true };
        } catch {
          return { output: 'No files found.', success: true };
        }
      }

      case 'search': {
        const pattern = input.pattern as string;
        const searchPath = input.path ? safePath(workspace, input.path as string) : workspace;
        const ctx = input.context ? `-C ${input.context}` : '';
        const globFilter = input.glob ? `--glob "${input.glob}"` : '';
        const cmd = `rg --line-number --max-count 50 ${ctx} ${globFilter} "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
        try {
          const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 512 * 1024 });
          return { output: result || 'No matches found.', success: true };
        } catch {
          return { output: 'No matches found.', success: true };
        }
      }

      case 'list_files': {
        const dirPath = input.path ? safePath(workspace, input.path as string) : workspace;
        const maxDepth = (input.depth as number) || 2;
        const lines = listDir(dirPath, '', 0, maxDepth);
        return { output: lines.join('\n') || '(empty directory)', success: true };
      }

      case 'todo_write': {
        const todos = input.todos as Array<{ id: string; content: string; status: string }>;
        const formatted = todos.map(t => {
          const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
          return `${icon} [${t.id}] ${t.content} (${t.status})`;
        }).join('\n');
        return { output: `Todo list updated:\n${formatted}`, success: true };
      }

      default:
        return { output: `Unknown tool: ${name}`, success: false };
    }
  } catch (err) {
    return { output: `Tool error: ${err instanceof Error ? err.message : String(err)}`, success: false };
  }
}
