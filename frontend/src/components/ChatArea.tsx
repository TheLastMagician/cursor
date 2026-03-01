import { useEffect, useRef, useState } from 'react';
import { Send, Bot, Brain, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AgentEvent } from '../types';
import ToolCallCard from './ToolCallCard';

interface Props {
  events: AgentEvent[];
  isRunning: boolean;
  onSubmit: (prompt: string) => void;
}

export default function ChatArea({ events, isRunning, onSubmit }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

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

  const mergedEvents = mergeToolEvents(events);

  return (
    <div className="flex-1 flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {mergedEvents.length === 0 && !isRunning ? (
          <EmptyState />
        ) : (
          mergedEvents.map((item, i) => (
            <EventItem key={i} item={item} />
          ))
        )}
        {isRunning && (
          <div className="flex items-center gap-2 text-blue-400 text-sm py-2 animate-pulse">
            <Bot size={16} />
            <span>Agent is working...</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-dark-700/50">
        <div className="flex gap-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your task... (e.g., Create a Python script that calculates fibonacci numbers)"
              className="w-full bg-dark-800 border border-dark-600/50 rounded-xl px-4 py-3 pr-12
                         text-sm text-dark-50 placeholder-dark-400 resize-none
                         focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40
                         transition-all duration-150"
              rows={2}
              disabled={isRunning}
            />
            <button
              type="submit"
              disabled={!input.trim() || isRunning}
              className="absolute right-3 bottom-3 p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500
                         disabled:bg-dark-600 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={14} className="text-white" />
            </button>
          </div>
        </div>
        <p className="text-center text-[11px] text-dark-500 mt-2">
          Press Enter to send · Shift+Enter for new line
        </p>
      </form>
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
        } else {
          items.push({ kind: 'tool', tool: 'unknown', input: {}, output: ev.output, success: ev.success });
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
      return (
        <div className="flex items-start gap-2 text-dark-400 text-sm animate-slide-in">
          <Brain size={14} className="mt-0.5 text-violet-400 flex-shrink-0" />
          <span className="italic">{item.content}</span>
        </div>
      );
    case 'message':
      return (
        <div className="flex items-start gap-2.5 animate-slide-in">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot size={13} className="text-white" />
          </div>
          <div className="text-sm text-dark-100 leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
            {formatMessage(item.content)}
          </div>
        </div>
      );
    case 'error':
      return (
        <div className="flex items-start gap-2 text-red-400 text-sm bg-red-950/20 rounded-lg px-3 py-2 animate-slide-in">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{item.content}</span>
        </div>
      );
    case 'tool':
      return (
        <div className="ml-8 animate-slide-in">
          <ToolCallCard
            tool={item.tool}
            input={item.input}
            output={item.output}
            success={item.success}
          />
        </div>
      );
    case 'status':
      return (
        <div className="flex items-center gap-2 text-sm text-emerald-400 py-1 animate-slide-in">
          <CheckCircle2 size={14} />
          <span>Task {item.status}</span>
        </div>
      );
    default:
      return null;
  }
}

function formatMessage(content: string): React.ReactNode {
  const parts = content.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-dark-700 text-blue-300 px-1.5 py-0.5 rounded text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-600/20 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
          <Bot size={28} className="text-blue-400" />
        </div>
        <h2 className="text-xl font-semibold text-dark-100 mb-2">Agent Cloud</h2>
        <p className="text-dark-400 text-sm leading-relaxed mb-6">
          Submit a task and watch the autonomous agent work.
          It can write code, run commands, search files, and more.
        </p>
        <div className="grid grid-cols-1 gap-2 text-left">
          {[
            'Create a Python script that generates prime numbers',
            'Build a simple REST API with Express.js',
            'Write unit tests for a calculator module',
          ].map((example, i) => (
            <div
              key={i}
              className="text-xs text-dark-300 bg-dark-800/50 rounded-lg px-3 py-2 border border-dark-700/30"
            >
              "{example}"
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
