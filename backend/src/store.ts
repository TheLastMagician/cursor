import { Task, TaskStatus, AgentEvent } from './types.js';
import type OpenAI from 'openai';

class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private conversations: Map<string, OpenAI.ChatCompletionMessageParam[]> = new Map();

  create(task: Task): Task {
    this.tasks.set(task.id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(): Task[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  updateStatus(id: string, status: TaskStatus): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status;
      if (status === 'completed' || status === 'failed') {
        task.completedAt = new Date().toISOString();
        task.workedDuration = Math.round(
          (new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 1000
        );
      }
    }
  }

  addEvent(id: string, event: AgentEvent): void {
    const task = this.tasks.get(id);
    if (task) task.events.push(event);
  }

  setConversation(id: string, messages: OpenAI.ChatCompletionMessageParam[]): void {
    this.conversations.set(id, messages);
  }

  getConversation(id: string): OpenAI.ChatCompletionMessageParam[] | undefined {
    return this.conversations.get(id);
  }
}

export const store = new TaskStore();
