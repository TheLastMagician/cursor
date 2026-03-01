import { useState } from 'react';
import { Terminal, FileText, FolderOpen, Search, PenTool, ChevronRight, ChevronDown, Check, X } from 'lucide-react';

interface Props {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  success?: boolean;
}

const toolMeta: Record<string, { icon: typeof Terminal; label: string; color: string }> = {
  shell: { icon: Terminal, label: 'Shell', color: 'text-amber-600' },
  read_file: { icon: FileText, label: 'Read File', color: 'text-sky-600' },
  write_file: { icon: PenTool, label: 'Write File', color: 'text-green-600' },
  search: { icon: Search, label: 'Search', color: 'text-violet-600' },
  list_files: { icon: FolderOpen, label: 'List Files', color: 'text-orange-600' },
};

export default function ToolCallCard({ tool, input, output, success }: Props) {
  const [expanded, setExpanded] = useState(false);
  const meta = toolMeta[tool] || { icon: Terminal, label: tool, color: 'text-gray-600' };
  const Icon = meta.icon;
  const summary = getInputSummary(tool, input);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white animate-slide-up">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />
        }
        <Icon size={13} className={`${meta.color} flex-shrink-0`} />
        <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
        <span className="text-xs text-gray-400 truncate flex-1 font-mono">{summary}</span>
        {success !== undefined && (
          success
            ? <Check size={13} className="text-green-500 flex-shrink-0" />
            : <X size={13} className="text-red-500 flex-shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-2">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Input</p>
            <pre className="text-xs text-gray-600 bg-gray-50 rounded-md p-2 overflow-x-auto max-h-28 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {output !== undefined && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Output</p>
              <pre className={`text-xs rounded-md p-2 overflow-x-auto max-h-48 overflow-y-auto ${
                success === false ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'
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
    case 'shell': return `$ ${input.command}`;
    case 'read_file': return String(input.path || '');
    case 'write_file': return String(input.path || '');
    case 'search': return `/${input.pattern}/` + (input.glob ? ` ${input.glob}` : '');
    case 'list_files': return String(input.path || '.');
    default: return '';
  }
}
