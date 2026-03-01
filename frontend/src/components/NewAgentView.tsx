import { useState } from 'react';
import { ChevronDown, Image, ArrowUp, Shield, FileText, Wrench } from 'lucide-react';
import type { Task } from '../types';

interface Props {
  tasks: Task[];
  onSubmit: (prompt: string) => void;
  onSelectTask: (id: string) => void;
  isRunning: boolean;
}

export default function NewAgentView({ tasks, onSubmit, onSelectTask, isRunning }: Props) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    onSubmit(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center pt-16 px-6 overflow-y-auto">
      <div className="w-full max-w-[680px]">
        {/* Repository selector */}
        <button className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-3 transition-colors">
          Select repository
          <ChevronDown size={14} />
        </button>

        {/* Main input area */}
        <div className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Cursor to build, fix bugs, explore"
            className="w-full px-4 pt-4 pb-12 text-[15px] text-gray-900 placeholder-gray-400 resize-none focus:outline-none min-h-[120px]"
            disabled={isRunning}
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center">
              <button className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:bg-gray-100 transition-colors">
                Codex 5.3 High
                <ChevronDown size={12} />
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <Image size={16} />
              </button>
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || isRunning}
                className="w-7 h-7 rounded-full bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 flex items-center justify-center transition-colors"
              >
                <ArrowUp size={14} className="text-white" />
              </button>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <QuickAction icon={<Shield size={13} />} label="Run security audit" />
          <QuickAction icon={<FileText size={13} />} label="Improve AGENTS.md" />
          <QuickAction icon={<Wrench size={13} />} label="Add tools" />
        </div>

        {/* Recent tasks */}
        {tasks.length > 0 && (
          <div className="mt-10 space-y-3">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} onClick={() => onSelectTask(task.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
      {icon}
      {label}
    </button>
  );
}

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 bg-white hover:shadow-sm hover:border-gray-300 transition-all text-left group"
    >
      {/* Thumbnail */}
      <div className="w-[100px] h-[68px] rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
        <div className="text-[10px] text-gray-400 text-center px-2">
          {task.events.length > 0 ? `${task.events.length} steps` : 'No output'}
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {task.prompt.slice(0, 60)}{task.prompt.length > 60 ? '...' : ''}
        </p>
        <p className="text-xs text-gray-400 mt-1 flex items-center gap-2">
          <StatusPill status={task.status} />
          <span>{formatRelativeTime(task.createdAt)}</span>
        </p>
      </div>
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    running: { bg: 'bg-blue-50', text: 'text-blue-600', label: '⟳ Running' },
    completed: { bg: 'bg-green-50', text: 'text-green-600', label: '✓ Done' },
    failed: { bg: 'bg-red-50', text: 'text-red-600', label: '✗ Failed' },
    queued: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: '◷ Queued' },
  };
  const c = config[status] || config.queued;
  return (
    <span className={`${c.bg} ${c.text} px-1.5 py-0.5 rounded text-[10px] font-medium`}>
      {c.label}
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
