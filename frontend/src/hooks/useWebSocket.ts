import { useEffect, useRef, useState, useCallback } from 'react';
import type { Task, AgentEvent } from '../types';

interface WsState {
  connected: boolean;
  tasks: Task[];
  activeTaskId: string | null;
  activeEvents: AgentEvent[];
  workedDuration: number | null;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<WsState>({
    connected: false,
    tasks: [],
    activeTaskId: null,
    activeEvents: [],
    workedDuration: null,
  });

  const handleMessage = useCallback((msg: { type: string; data: Record<string, unknown> }) => {
    switch (msg.type) {
      case 'task_list':
        setState((s) => ({ ...s, tasks: (msg.data.tasks as Task[]) || [] }));
        break;
      case 'task_created':
        setState((s) => ({
          ...s,
          activeTaskId: msg.data.taskId as string,
          activeEvents: [],
          workedDuration: null,
        }));
        break;
      case 'agent_event': {
        const event = msg.data.event as AgentEvent;
        setState((s) => ({ ...s, activeEvents: [...s.activeEvents, event] }));
        break;
      }
      case 'task_completed':
        setState((s) => ({
          ...s,
          workedDuration: (msg.data.workedDuration as number) || null,
          tasks: s.tasks.map((t) =>
            t.id === (msg.data.taskId as string) ? { ...t, status: 'completed' as const } : t
          ),
        }));
        break;
      case 'task_error':
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((t) =>
            t.id === (msg.data.taskId as string) ? { ...t, status: 'failed' as const } : t
          ),
        }));
        break;
    }
  }, []);

  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setState((s) => ({ ...s, connected: true }));
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        setTimeout(connect, 3000);
      };
      ws.onmessage = (ev) => {
        try { handleMessage(JSON.parse(ev.data)); } catch { /* ignore */ }
      };
    };
    connect();
    return () => { wsRef.current?.close(); };
  }, [handleMessage]);

  const createTask = useCallback((prompt: string, workspace?: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'create_task', data: { prompt, workspace } }));
    }
  }, []);

  const followUp = useCallback((taskId: string, prompt: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'follow_up', data: { taskId, prompt } }));
    }
  }, []);

  return { ...state, createTask, followUp };
}
