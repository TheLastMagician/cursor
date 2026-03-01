import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { ToolDefinition, ToolResult } from './types.js';

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'shell',
    description: 'Execute a shell command in the workspace directory. Returns stdout, stderr, and exit code. Use for running scripts, installing packages, git operations, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        working_directory: { type: 'string', description: 'Working directory (relative to workspace). Defaults to workspace root.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace' },
        offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file and any parent directories if they do not exist. Overwrites existing content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'search',
    description: 'Search for a pattern in files using ripgrep. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search in (relative to workspace). Defaults to workspace root.' },
        glob: { type: 'string', description: 'File glob pattern to filter, e.g. "*.ts"' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories in the given path. Returns a tree-like listing.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to workspace. Defaults to workspace root.' },
        depth: { type: 'number', description: 'Maximum depth to recurse. Defaults to 2.' },
      },
      required: [],
    },
  },
];

function safePath(workspace: string, relativePath: string): string {
  const resolved = resolve(workspace, relativePath);
  if (!resolved.startsWith(resolve(workspace))) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  return resolved;
}

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
          const childPrefix = prefix + (isLast ? '    ' : '│   ');
          lines.push(...listDir(fullPath, childPrefix, depth + 1, maxDepth));
        } else {
          const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
          lines.push(`${prefix}${connector}${entry} (${size})`);
        }
      } catch {
        lines.push(`${prefix}${connector}${entry} [permission denied]`);
      }
    }
  } catch {
    lines.push(`${prefix}[cannot read directory]`);
  }
  return lines;
}

export function executeTool(name: string, input: Record<string, unknown>, workspace: string): ToolResult {
  try {
    switch (name) {
      case 'shell': {
        const command = input.command as string;
        const cwd = input.working_directory
          ? safePath(workspace, input.working_directory as string)
          : workspace;
        try {
          const stdout = execSync(command, {
            cwd,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            encoding: 'utf-8',
            env: { ...process.env, PATH: process.env.PATH },
          });
          return { output: `$ ${command}\n${stdout}`, success: true };
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; status?: number };
          const output = [
            `$ ${command}`,
            e.stdout || '',
            e.stderr || '',
            `Exit code: ${e.status ?? 1}`,
          ].filter(Boolean).join('\n');
          return { output, success: false };
        }
      }

      case 'read_file': {
        const filePath = safePath(workspace, input.path as string);
        if (!existsSync(filePath)) {
          return { output: `File not found: ${input.path}`, success: false };
        }
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
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(filePath, input.content as string, 'utf-8');
        return { output: `Written to ${input.path} (${(input.content as string).length} bytes)`, success: true };
      }

      case 'search': {
        const pattern = input.pattern as string;
        const searchPath = input.path
          ? safePath(workspace, input.path as string)
          : workspace;
        let cmd = `rg --line-number --max-count 50 "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
        if (input.glob) {
          cmd += ` --glob "${input.glob}"`;
        }
        try {
          const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 512 * 1024 });
          return { output: result || 'No matches found.', success: true };
        } catch {
          return { output: 'No matches found.', success: true };
        }
      }

      case 'list_files': {
        const dirPath = input.path
          ? safePath(workspace, input.path as string)
          : workspace;
        const maxDepth = (input.depth as number) || 2;
        const lines = listDir(dirPath, '', 0, maxDepth);
        return { output: lines.join('\n') || '(empty directory)', success: true };
      }

      default:
        return { output: `Unknown tool: ${name}`, success: false };
    }
  } catch (err) {
    return { output: `Tool error: ${err instanceof Error ? err.message : String(err)}`, success: false };
  }
}
