import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Task, TaskStatus, AgentEvent } from './types.js';
import type OpenAI from 'openai';

const DATA_FILE = '/tmp/agent-cloud-tasks.json';

class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private conversations: Map<string, OpenAI.ChatCompletionMessageParam[]> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (existsSync(DATA_FILE)) {
        const data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
        if (Array.isArray(data)) {
          for (const task of data) {
            this.tasks.set(task.id, task);
          }
          console.log(`[Store] Loaded ${data.length} tasks from disk`);
        }
      }
    } catch { /* ignore */ }
  }

  private saveToDisk(): void {
    try {
      const tasks = Array.from(this.tasks.values());
      writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  create(task: Task): Task {
    this.tasks.set(task.id, task);
    this.saveToDisk();
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
      this.saveToDisk();
    }
  }

  addEvent(id: string, event: AgentEvent): void {
    const task = this.tasks.get(id);
    if (task) task.events.push(event);
    // Save periodically (every 10 events)
    if (task && task.events.length % 10 === 0) this.saveToDisk();
  }

  setConversation(id: string, messages: OpenAI.ChatCompletionMessageParam[]): void {
    this.conversations.set(id, messages);
  }

  getConversation(id: string): OpenAI.ChatCompletionMessageParam[] | undefined {
    return this.conversations.get(id);
  }

  delete(id: string): boolean {
    const deleted = this.tasks.delete(id);
    this.conversations.delete(id);
    if (deleted) this.saveToDisk();
    return deleted;
  }
}

export const store = new TaskStore();
