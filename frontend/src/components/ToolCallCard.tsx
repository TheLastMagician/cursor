import { useState } from 'react';
import { Terminal, FileText, FolderSearch, Search, PenTool, ChevronDown, ChevronRight, Check, X } from 'lucide-react';

interface Props {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  success?: boolean;
}

const toolIcons: Record<string, typeof Terminal> = {
  shell: Terminal,
  read_file: FileText,
  write_file: PenTool,
  search: Search,
  list_files: FolderSearch,
};

const toolColors: Record<string, string> = {
  shell: 'text-amber-400',
  read_file: 'text-sky-400',
  write_file: 'text-emerald-400',
  search: 'text-violet-400',
  list_files: 'text-orange-400',
};

export default function ToolCallCard({ tool, input, output, success }: Props) {
  const [expanded, setExpanded] = useState(true);
  const Icon = toolIcons[tool] || Terminal;
  const color = toolColors[tool] || 'text-dark-200';

  const inputSummary = getInputSummary(tool, input);

  return (
    <div className="tool-card animate-slide-in">
      <button
        className="tool-card-header w-full"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown size={14} className="text-dark-400" />
        ) : (
          <ChevronRight size={14} className="text-dark-400" />
        )}
        <Icon size={14} className={color} />
        <span className={`font-mono text-xs ${color}`}>{tool}</span>
        <span className="text-dark-400 text-xs truncate flex-1">{inputSummary}</span>
        {success !== undefined && (
          success ? (
            <Check size={14} className="text-emerald-400" />
          ) : (
            <X size={14} className="text-red-400" />
          )
        )}
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2">
          <div>
            <p className="text-[10px] text-dark-400 uppercase tracking-wider mb-1">Input</p>
            <pre className="text-xs text-dark-200 bg-dark-900/50 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {output !== undefined && (
            <div>
              <p className="text-[10px] text-dark-400 uppercase tracking-wider mb-1">Output</p>
              <pre className={`text-xs rounded p-2 overflow-x-auto max-h-64 overflow-y-auto ${
                success === false ? 'bg-red-950/30 text-red-300' : 'bg-dark-900/50 text-dark-200'
              }`}>
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getInputSummary(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'shell':
      return `$ ${input.command}`;
    case 'read_file':
      return String(input.path || '');
    case 'write_file':
      return String(input.path || '');
    case 'search':
      return `/${input.pattern}/` + (input.glob ? ` (${input.glob})` : '');
    case 'list_files':
      return String(input.path || '.');
    default:
      return '';
  }
}
