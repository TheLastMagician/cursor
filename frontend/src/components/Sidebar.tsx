import { Plus, LayoutDashboard, Search, Copy, Loader2, CheckCircle2, XCircle, GitBranch, GitMerge } from 'lucide-react';
import type { Task } from '../types';

interface Props {
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onNewAgent: () => void;
  connected: boolean;
}

export default function Sidebar({ tasks, activeTaskId, onSelectTask, onNewAgent, connected }: Props) {
  return (
    <aside className="w-[220px] bg-gray-50/80 border-r border-gray-200 flex flex-col h-full select-none">
      {/* Header */}
      <div className="px-3 pt-3 pb-1 flex items-center justify-between">
        <div className="w-7 h-7 rounded-md bg-black flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-md hover:bg-gray-200/70 text-gray-400 hover:text-gray-600 transition-colors">
            <Search size={14} />
          </button>
          <button className="p-1.5 rounded-md hover:bg-gray-200/70 text-gray-400 hover:text-gray-600 transition-colors">
            <Copy size={14} />
          </button>
        </div>
      </div>

      {/* Nav */}
      <div className="px-2 py-1 space-y-0.5">
        <button
          onClick={onNewAgent}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] font-medium text-gray-700 hover:bg-gray-200/60 transition-colors"
        >
          <Plus size={14} className="text-gray-500" />
          New Agent
        </button>
        <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-gray-600 hover:bg-gray-200/60 transition-colors">
          <LayoutDashboard size={14} className="text-gray-400" />
          Dashboard
        </button>
      </div>

      {/* Agent list */}
      <div className="mt-1 px-2 flex-1 overflow-y-auto">
        <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wider">
          Agents
        </p>
        <div className="space-y-0.5">
          {tasks.map((task) => {
            const isActive = task.id === activeTaskId;
            return (
              <button
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors group ${
                  isActive ? 'bg-gray-200/80 text-gray-900' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <StatusIcon status={task.status} />
                <span className="truncate flex-1 text-left">{task.prompt.slice(0, 30)}{task.prompt.length > 30 ? '...' : ''}</span>
                <TaskBadge task={task} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Connection status */}
      <div className="px-3 py-2 border-t border-gray-200 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-400'}`} />
        <span className="text-[11px] text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </aside>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 size={13} className="text-blue-500 animate-spin flex-shrink-0" />;
    case 'completed':
      return <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />;
    case 'failed':
      return <XCircle size={13} className="text-red-500 flex-shrink-0" />;
    default:
      return <div className="w-[13px] h-[13px] rounded-full border-2 border-gray-300 flex-shrink-0" />;
  }
}

function TaskBadge({ task }: { task: Task }) {
  const diff = computeDiffStats(task.events);

  if (task.status === 'completed') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">
        <GitMerge size={9} />
        Done
        {diff.added > 0 && <span className="text-green-500">+{diff.added}</span>}
        {diff.removed > 0 && <span className="text-red-400">-{diff.removed}</span>}
      </span>
    );
  }
  if (task.status === 'running') {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
        <GitBranch size={9} />
        Active
      </span>
    );
  }
  return null;
}

function computeDiffStats(events: Task['events']): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const ev of events) {
    if (ev.type === 'tool_call') {
      if (ev.tool === 'write_file') {
        const content = String(ev.input.contents || '');
        added += content.split('\n').length;
      } else if (ev.tool === 'str_replace') {
        const oldStr = String(ev.input.old_string || '');
        const newStr = String(ev.input.new_string || '');
        const oldLines = oldStr.split('\n').length;
        const newLines = newStr.split('\n').length;
        added += newLines;
        removed += oldLines;
      }
    }
  }
  return { added, removed };
}
