export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  prompt: string;
  workspace: string;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  workedDuration?: number;
  events: AgentEvent[];
}

export type AgentEvent =
  | { type: 'thinking'; content: string; timestamp: string }
  | { type: 'thinking_done'; duration: number; timestamp: string }
  | { type: 'tool_call'; id: string; tool: string; input: Record<string, unknown>; timestamp: string }
  | { type: 'tool_result'; id: string; output: string; success: boolean; timestamp: string }
  | { type: 'message'; content: string; timestamp: string }
  | { type: 'error'; content: string; timestamp: string }
  | { type: 'status'; status: TaskStatus; timestamp: string }
  | { type: 'user_message'; content: string; timestamp: string };

export interface WsClientMessage {
  type: 'create_task' | 'follow_up';
  data: { prompt: string; workspace?: string; taskId?: string };
}

export interface WsServerMessage {
  type: 'task_created' | 'agent_event' | 'task_completed' | 'task_error' | 'task_list';
  data: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  success: boolean;
}
