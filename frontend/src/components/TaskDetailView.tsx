import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Image, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Clock, User, Brain } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentEvent, Task } from '../types';
import ToolCallCard from './ToolCallCard';
import XTerminal from './XTerminal';

interface Props {
  task: Task | null;
  events: AgentEvent[];
  isRunning: boolean;
  workedDuration: number | null;
  onFollowUp: (taskId: string, prompt: string) => void;
  onNewTask: (prompt: string) => void;
}

type TabId = 'setup' | 'secrets' | 'git' | 'desktop' | 'terminal';

export default function TaskDetailView({ task, events, isRunning, workedDuration, onFollowUp, onNewTask }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('setup');
  const [followUp, setFollowUp] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = followUp.trim();
    if (!trimmed) return;
    if (task && task.status === 'completed') {
      onFollowUp(task.id, trimmed);
    } else if (!task) {
      onNewTask(trimmed);
    }
    setFollowUp('');
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'secrets', label: 'Secrets' },
    { id: 'git', label: 'Git' },
    { id: 'desktop', label: 'Desktop' },
    { id: 'terminal', label: 'Terminal' },
  ];

  const merged = mergeEvents(events);
  const duration = workedDuration || task?.workedDuration;

  return (
    <div className="flex-1 flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3 py-2.5 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate max-w-[400px]">
            {task?.prompt.slice(0, 60)}{(task?.prompt?.length ?? 0) > 60 ? '...' : ''}
          </span>
        </div>
        <div className="flex items-center">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-[13px] transition-colors relative ${
                activeTab === tab.id ? 'text-gray-900 font-medium' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gray-900" />}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
            <div className="max-w-[720px] space-y-4">
              {/* User prompt */}
              {task && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 text-[14px] text-gray-800 leading-relaxed border border-gray-100">
                  {task.prompt}
                </div>
              )}

              {/* Duration */}
              {!isRunning && duration && (
                <p className="text-xs text-gray-400">
                  {task?.status === 'completed' ? 'Environment ready' : 'Task ended'}
                  <br />Worked for {formatDuration(duration)}
                </p>
              )}

              {/* Events */}
              {merged.map((item, i) => <EventItem key={i} item={item} />)}

              {isRunning && (
                <div className="flex items-center gap-2 text-sm text-blue-500 py-1">
                  <Loader2 size={14} className="animate-spin" />
                  Agent is working...
                </div>
              )}
            </div>
          </div>

          {/* Bottom */}
          <div className="border-t border-gray-200">
            {isRunning && (
              <div className="px-6 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                <span className="text-xs text-amber-700">Agent is running...</span>
                <button className="text-xs font-medium text-amber-700 hover:text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100">Stop</button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="px-6 py-3 flex items-center gap-2">
              <input
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder={isRunning ? 'Agent is working...' : 'Add follow up for agent'}
                className="flex-1 text-sm text-gray-900 placeholder-gray-400 bg-transparent focus:outline-none"
                disabled={isRunning}
              />
              <button type="button" className="p-1 text-gray-400 hover:text-gray-600"><Image size={16} /></button>
              <button
                type="submit"
                disabled={!followUp.trim() || isRunning}
                className="w-7 h-7 rounded-full bg-gray-900 hover:bg-gray-700 disabled:bg-gray-200 flex items-center justify-center transition-colors"
              >
                <ArrowUp size={13} className="text-white" />
              </button>
            </form>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-[340px] border-l border-gray-200 bg-gray-50/50 overflow-y-auto hidden lg:block">
          <RightPanel tab={activeTab} task={task} isRunning={isRunning} events={events} />
        </div>
      </div>
    </div>
  );
}

function RightPanel({ tab, task, isRunning, events }: { tab: TabId; task: Task | null; isRunning: boolean; events: AgentEvent[] }) {
  switch (tab) {
    case 'setup': return <SetupPanel task={task} isRunning={isRunning} events={events} />;
    case 'secrets': return <SecretsPanel />;
    case 'git': return <GitPanel />;
    case 'desktop': return <DesktopPanel events={events} />;
    case 'terminal': return <TerminalPanel taskId={task?.id || 'default'} />;
    default: return null;
  }
}

function SetupPanel({ task, isRunning, events }: { task: Task | null; isRunning: boolean; events: AgentEvent[] }) {
  const toolCalls = events.filter(e => e.type === 'tool_call').length;
  const errors = events.filter(e => e.type === 'error').length;
  const steps = events.length;

  return (
    <div className="p-5 space-y-4">
      {/* Status */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-3">Status</h3>
        <div className="flex items-center gap-2 mb-3">
          {isRunning ? (
            <><Loader2 size={14} className="text-blue-500 animate-spin" /><span className="text-sm font-medium text-blue-600">Running</span></>
          ) : task?.status === 'completed' ? (
            <><CheckCircle2 size={14} className="text-green-500" /><span className="text-sm font-medium text-green-600">Completed</span></>
          ) : task?.status === 'failed' ? (
            <><AlertTriangle size={14} className="text-red-500" /><span className="text-sm font-medium text-red-600">Failed</span></>
          ) : (
            <><Clock size={14} className="text-gray-400" /><span className="text-sm text-gray-500">Idle</span></>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Steps" value={steps} />
          <Stat label="Tool Calls" value={toolCalls} />
          <Stat label="Errors" value={errors} />
        </div>
      </div>

      {/* Learn more */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Learn more about Cloud Agents</h3>
        </div>
        <a href="#" className="text-xs text-blue-600 hover:underline">Read docs →</a>
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">
          Agent Cloud runs autonomous coding agents in isolated cloud environments. Agents can write code, run commands, search files, and verify their work.
        </p>
      </div>

      {/* Save environment */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">Save environment</h3>
        <p className="text-xs text-gray-500 mb-3">The environment consists of a machine snapshot and an update script for refreshing dependencies.</p>
        <div className="bg-gray-900 rounded-lg p-3 text-xs text-gray-300 font-mono">
          <div><span className="text-gray-500">1</span> pnpm install</div>
        </div>
        <button className="mt-3 w-full text-xs font-medium text-white bg-gray-900 hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors">
          Save to team
        </button>
      </div>
    </div>
  );
}

function SecretsPanel() {
  return (
    <div className="p-5 space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-3">Add Secrets</h3>
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-400 uppercase tracking-wider">
            <span>Name</span><span>Value</span><span>Type</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input className="border border-gray-200 rounded px-2 py-1 text-xs" placeholder="Name" />
            <input className="border border-gray-200 rounded px-2 py-1 text-xs" placeholder="Value" type="password" />
            <select className="border border-gray-200 rounded px-2 py-1 text-xs">
              <option>Secret</option><option>Redacted</option>
            </select>
          </div>
        </div>
        <button className="mt-3 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5">Save</button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-3">Existing Secrets</h3>
        <div className="space-y-2 text-xs text-gray-500">
          <div className="flex justify-between py-1 border-b border-gray-100">
            <span className="font-mono text-gray-700">MINIMAX_API_KEY</span>
            <span className="text-gray-400">Team</span>
          </div>
        </div>
        <div className="mt-3 flex gap-3">
          <a href="#" className="text-xs text-blue-600 hover:underline">Manage secrets in settings ↗</a>
          <a href="#" className="text-xs text-blue-600 hover:underline">Sync secrets to agent</a>
        </div>
      </div>
    </div>
  );
}

function GitPanel() {
  return (
    <div className="p-5 space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-900">Agent Cloud #1 ↗</h3>
          <button className="text-xs font-medium text-white bg-gray-900 rounded-lg px-3 py-1.5">Finish setup</button>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">↙ Merged</span>
          <span className="font-mono">cursor/agent-cloud → main</span>
        </div>
        <div className="mt-3 flex gap-4 border-b border-gray-200 text-xs">
          <button className="pb-2 border-b-2 border-gray-900 font-medium text-gray-900">Diff</button>
          <button className="pb-2 text-gray-400 hover:text-gray-600">Review</button>
          <button className="pb-2 text-gray-400 hover:text-gray-600">Commits</button>
        </div>
        <div className="mt-3 space-y-1 text-xs">
          <p className="text-gray-500">Files changed will appear here when the agent modifies code.</p>
        </div>
      </div>
    </div>
  );
}

function DesktopPanel({ events }: { events: AgentEvent[] }) {
  const shellResults = events.filter(e =>
    e.type === 'tool_result' && (e as Extract<AgentEvent, {type:'tool_result'}>).success
  ) as Extract<AgentEvent, {type:'tool_result'}>[];
  
  const shellCommands = events.filter(e =>
    e.type === 'tool_call' && (e as Extract<AgentEvent, {type:'tool_call'}>).tool === 'shell'
  ) as Extract<AgentEvent, {type:'tool_call'}>[];

  return (
    <div className="p-4 space-y-3 h-full overflow-y-auto">
      {shellCommands.length === 0 ? (
        <div className="bg-gray-100 rounded-xl border border-gray-200 aspect-video flex items-center justify-center">
          <p className="text-xs text-gray-400">Shell output will appear here during agent execution.</p>
        </div>
      ) : (
        shellCommands.map((cmd, i) => {
          const result = shellResults.find(r => r.id === cmd.id);
          return (
            <div key={i} className="bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
              <div className="px-3 py-1.5 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                </div>
                <span className="text-[10px] text-gray-400 font-mono">Terminal</span>
              </div>
              <div className="p-3 font-mono text-xs">
                <div className="text-green-400">$ {String(cmd.input.command)}</div>
                {result && (
                  <pre className="text-gray-300 mt-1 whitespace-pre-wrap max-h-60 overflow-y-auto">{result.output}</pre>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function TerminalPanel({ taskId }: { taskId: string }) {
  return (
    <div className="h-full bg-[#1a1b26]">
      <XTerminal taskId={taskId} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-lg py-2">
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  );
}

type MergedItem =
  | { kind: 'thinking'; duration?: number }
  | { kind: 'message'; content: string }
  | { kind: 'error'; content: string }
  | { kind: 'tool'; tool: string; input: Record<string, unknown>; output?: string; success?: boolean }
  | { kind: 'status'; status: string }
  | { kind: 'user_message'; content: string };

function mergeEvents(events: AgentEvent[]): MergedItem[] {
  const items: MergedItem[] = [];
  const toolCalls = new Map<string, MergedItem & { kind: 'tool' }>();
  let lastThinking: (MergedItem & { kind: 'thinking' }) | null = null;

  for (const ev of events) {
    switch (ev.type) {
      case 'thinking':
        lastThinking = { kind: 'thinking' };
        items.push(lastThinking);
        break;
      case 'thinking_done':
        if (lastThinking) lastThinking.duration = ev.duration;
        else items.push({ kind: 'thinking', duration: ev.duration });
        lastThinking = null;
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
      case 'user_message':
        items.push({ kind: 'user_message', content: ev.content });
        break;
      case 'tool_call': {
        const item: MergedItem & { kind: 'tool' } = { kind: 'tool', tool: ev.tool, input: ev.input };
        toolCalls.set(ev.id, item);
        items.push(item);
        break;
      }
      case 'tool_result': {
        const existing = toolCalls.get(ev.id);
        if (existing) { existing.output = ev.output; existing.success = ev.success; }
        break;
      }
    }
  }
  return items;
}

function EventItem({ item }: { item: MergedItem }) {
  switch (item.kind) {
    case 'thinking': return <ThinkingBlock duration={item.duration} />;
    case 'user_message':
      return (
        <div className="bg-gray-50 rounded-xl px-4 py-3 text-[14px] text-gray-800 leading-relaxed border border-gray-100 animate-slide-up flex items-start gap-2">
          <User size={14} className="text-gray-400 mt-1 flex-shrink-0" />
          <span>{item.content}</span>
        </div>
      );
    case 'message':
      return (
        <div className="animate-slide-up prose prose-sm max-w-none prose-gray prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px] prose-code:font-mono prose-pre:bg-gray-50 prose-pre:border prose-pre:border-gray-200 prose-pre:text-[12px] prose-thead:border-gray-200 prose-td:border-gray-200">
          <Markdown remarkPlugins={[remarkGfm]}>{item.content}</Markdown>
        </div>
      );
    case 'error':
      return (
        <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100 animate-slide-up">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{item.content}</span>
        </div>
      );
    case 'tool':
      return <div className="animate-slide-up"><ToolCallCard tool={item.tool} input={item.input} output={item.output} success={item.success} /></div>;
    case 'status':
      return (
        <div className="flex items-center gap-2 text-sm text-green-600 py-1 animate-slide-up">
          <CheckCircle2 size={14} /><span>Task {item.status}</span>
        </div>
      );
    default: return null;
  }
}

function ThinkingBlock({ duration }: { duration?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors py-1 animate-slide-up">
      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      <Brain size={12} />
      {duration != null
        ? <span>Thought for {duration}s</span>
        : <><Loader2 size={10} className="animate-spin" /><span>Thinking...</span></>
      }
    </button>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
