import { useEffect, useRef, useState, useCallback } from 'react';
import type { Task, AgentEvent } from '../types';

interface WsState {
  connected: boolean;
  tasks: Task[];
  activeTaskId: string | null;
  activeEvents: AgentEvent[];
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<WsState>({
    connected: false,
    tasks: [],
    activeTaskId: null,
    activeEvents: [],
  });

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      }, 3000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleMessage(msg);
      } catch { /* ignore parse errors */ }
    };

    return () => {
      ws.close();
    };
  }, []);

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
        }));
        break;

      case 'agent_event': {
        const event = msg.data.event as AgentEvent;
        setState((s) => ({
          ...s,
          activeEvents: [...s.activeEvents, event],
        }));
        break;
      }

      case 'task_completed':
      case 'task_error':
        setState((s) => {
          const updatedTasks = s.tasks.map((t) =>
            t.id === (msg.data.taskId as string)
              ? { ...t, status: (msg.type === 'task_completed' ? 'completed' : 'failed') as Task['status'] }
              : t,
          );
          return { ...s, tasks: updatedTasks };
        });
        break;
    }
  }, []);

  const createTask = useCallback((prompt: string, workspace?: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'create_task',
        data: { prompt, workspace },
      }));
    }
  }, []);

  return { ...state, createTask };
}
