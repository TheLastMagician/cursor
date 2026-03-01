import { Zap, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import type { Task } from '../types';

interface Props {
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  connected: boolean;
}

const statusConfig: Record<string, { icon: typeof Loader2; color: string; label: string }> = {
  running: { icon: Loader2, color: 'text-blue-400', label: 'Running' },
  completed: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Done' },
  failed: { icon: XCircle, color: 'text-red-400', label: 'Failed' },
  queued: { icon: Clock, color: 'text-yellow-400', label: 'Queued' },
  cancelled: { icon: XCircle, color: 'text-dark-300', label: 'Cancelled' },
};

export default function Sidebar({ tasks, activeTaskId, onSelectTask, connected }: Props) {
  return (
    <aside className="w-72 bg-dark-900 border-r border-dark-700/50 flex flex-col h-full">
      <div className="p-4 border-b border-dark-700/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <Zap className="w-4.5 h-4.5 text-white" size={18} />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight">Agent Cloud</h1>
            <p className="text-[11px] text-dark-300 leading-none mt-0.5">Autonomous Coding Agent</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-xs text-dark-300">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <p className="text-[11px] text-dark-400 uppercase tracking-wider font-medium px-2 py-2">
          Tasks ({tasks.length})
        </p>
        {tasks.length === 0 ? (
          <p className="text-sm text-dark-400 px-2 py-4 text-center">
            No tasks yet. Submit one below!
          </p>
        ) : (
          <div className="space-y-1">
            {tasks.map((task) => {
              const config = statusConfig[task.status] || statusConfig.queued;
              const Icon = config.icon;
              const isActive = task.id === activeTaskId;
              return (
                <button
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors group ${
                    isActive
                      ? 'bg-dark-700/70 border border-dark-600/50'
                      : 'hover:bg-dark-800/70 border border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Icon
                      size={14}
                      className={`${config.color} mt-0.5 flex-shrink-0 ${
                        task.status === 'running' ? 'animate-spin' : ''
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-dark-100 truncate leading-snug">
                        {task.prompt.slice(0, 60)}
                        {task.prompt.length > 60 ? '...' : ''}
                      </p>
                      <p className="text-[11px] text-dark-400 mt-0.5">
                        {config.label} · {formatTime(task.createdAt)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
