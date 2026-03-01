import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Image, Square, Bot, Brain, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Clock } from 'lucide-react';
import type { AgentEvent, Task } from '../types';
import ToolCallCard from './ToolCallCard';

interface Props {
  task: Task | null;
  events: AgentEvent[];
  isRunning: boolean;
  onFollowUp: (prompt: string) => void;
}

type TabId = 'setup' | 'terminal';

export default function TaskDetailView({ task, events, isRunning, onFollowUp }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('setup');
  const [followUp, setFollowUp] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const handleFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = followUp.trim();
    if (!trimmed || isRunning) return;
    onFollowUp(trimmed);
    setFollowUp('');
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'terminal', label: 'Terminal' },
  ];

  const merged = mergeToolEvents(events);

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header with tabs */}
      <div className="border-b border-gray-200 px-6 flex items-center justify-between bg-white">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 py-3">
            <span className="text-sm font-medium text-gray-900 truncate max-w-[300px]">
              {task?.prompt.slice(0, 50)}{(task?.prompt.length ?? 0) > 50 ? '...' : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm transition-colors relative ${
                activeTab === tab.id
                  ? 'text-gray-900 font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main content */}
        <div className="flex-1 flex flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
            <div className="max-w-[720px] space-y-4">
              {/* User message */}
              {task && (
                <div className="text-[15px] text-gray-900 leading-relaxed whitespace-pre-wrap">
                  {task.prompt}
                </div>
              )}

              {/* Agent events */}
              {merged.map((item, i) => (
                <EventItem key={i} item={item} />
              ))}

              {isRunning && (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-1">
                  <Loader2 size={14} className="animate-spin" />
                  Agent is working...
                </div>
              )}
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-gray-200 bg-white">
            {isRunning && (
              <div className="px-6 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                <span className="text-xs text-amber-700">Agent is running...</span>
                <button className="text-xs text-amber-700 hover:text-amber-900 font-medium px-2 py-0.5 rounded hover:bg-amber-100 transition-colors">
                  Stop
                </button>
              </div>
            )}
            <form onSubmit={handleFollowUp} className="px-6 py-3 flex items-center gap-2">
              <input
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder="Add follow up for agent"
                className="flex-1 text-sm text-gray-900 placeholder-gray-400 bg-transparent focus:outline-none"
                disabled={isRunning}
              />
              <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <Image size={16} />
              </button>
              <button
                type="submit"
                disabled={!followUp.trim() || isRunning}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:text-gray-300 transition-colors"
              >
                <ArrowUp size={16} />
              </button>
            </form>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-[340px] border-l border-gray-200 bg-gray-50/50 overflow-y-auto p-5 hidden lg:block">
          <RightPanel task={task} isRunning={isRunning} />
        </div>
      </div>
    </div>
  );
}

function RightPanel({ task, isRunning }: { task: Task | null; isRunning: boolean }) {
  const eventCount = task?.events.length ?? 0;
  const toolCalls = task?.events.filter(e => e.type === 'tool_call').length ?? 0;
  const errors = task?.events.filter(e => e.type === 'error').length ?? 0;

  return (
    <div className="space-y-5">
      {/* Status card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Status</h3>
        <div className="flex items-center gap-2 mb-3">
          {isRunning ? (
            <>
              <Loader2 size={14} className="text-blue-500 animate-spin" />
              <span className="text-sm font-medium text-blue-600">Running</span>
            </>
          ) : task?.status === 'completed' ? (
            <>
              <CheckCircle2 size={14} className="text-green-500" />
              <span className="text-sm font-medium text-green-600">Completed</span>
            </>
          ) : task?.status === 'failed' ? (
            <>
              <AlertTriangle size={14} className="text-red-500" />
              <span className="text-sm font-medium text-red-600">Failed</span>
            </>
          ) : (
            <>
              <Clock size={14} className="text-gray-400" />
              <span className="text-sm text-gray-500">Idle</span>
            </>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-lg font-semibold text-gray-900">{eventCount}</p>
            <p className="text-[10px] text-gray-400">Steps</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-lg font-semibold text-gray-900">{toolCalls}</p>
            <p className="text-[10px] text-gray-400">Tool Calls</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-lg font-semibold text-gray-900">{errors}</p>
            <p className="text-[10px] text-gray-400">Errors</p>
          </div>
        </div>
      </div>

      {/* Learn more */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Learn more</h3>
          <a href="#" className="text-xs text-blue-600 hover:underline">Read docs →</a>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Agent Cloud runs autonomous coding agents in isolated cloud environments. Agents can write code, run commands, search files, and verify their work.
        </p>
      </div>
    </div>
  );
}

type MergedItem =
  | { kind: 'thinking'; content: string }
  | { kind: 'message'; content: string }
  | { kind: 'error'; content: string }
  | { kind: 'tool'; tool: string; input: Record<string, unknown>; output?: string; success?: boolean }
  | { kind: 'status'; status: string };

function mergeToolEvents(events: AgentEvent[]): MergedItem[] {
  const items: MergedItem[] = [];
  const toolCalls = new Map<string, MergedItem & { kind: 'tool' }>();

  for (const ev of events) {
    switch (ev.type) {
      case 'thinking':
        items.push({ kind: 'thinking', content: ev.content });
        break;
      case 'message':
        items.push({ kind: 'message', content: ev.content });
        break;
      case 'error':
        items.push({ kind: 'error', content: ev.content });
        break;
      case 'status':
        items.push({ kind: 'status', status: ev.status });
        break;
      case 'tool_call': {
        const item: MergedItem & { kind: 'tool' } = { kind: 'tool', tool: ev.tool, input: ev.input };
        toolCalls.set(ev.id, item);
        items.push(item);
        break;
      }
      case 'tool_result': {
        const existing = toolCalls.get(ev.id);
        if (existing) {
          existing.output = ev.output;
          existing.success = ev.success;
        }
        break;
      }
    }
  }
  return items;
}

function EventItem({ item }: { item: MergedItem }) {
  switch (item.kind) {
    case 'thinking':
      return <ThinkingBlock content={item.content} />;
    case 'message':
      return (
        <div className="animate-slide-up">
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {formatMessage(item.content)}
          </div>
        </div>
      );
    case 'error':
      return (
        <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 animate-slide-up border border-red-100">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{item.content}</span>
        </div>
      );
    case 'tool':
      return (
        <div className="animate-slide-up">
          <ToolCallCard tool={item.tool} input={item.input} output={item.output} success={item.success} />
        </div>
      );
    case 'status':
      return (
        <div className="flex items-center gap-2 text-sm text-green-600 py-1 animate-slide-up">
          <CheckCircle2 size={14} />
          <span>Task {item.status}</span>
        </div>
      );
    default:
      return null;
  }
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors py-1 animate-slide-up"
    >
      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      <Brain size={12} />
      <span>{content}</span>
    </button>
  );
}

function formatMessage(content: string): React.ReactNode {
  const parts = content.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
