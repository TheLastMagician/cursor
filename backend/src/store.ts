import { Task, TaskStatus, AgentEvent } from './types.js';

class TaskStore {
  private tasks: Map<string, Task> = new Map();

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
      }
    }
  }

  addEvent(id: string, event: AgentEvent): void {
    const task = this.tasks.get(id);
    if (task) {
      task.events.push(event);
    }
  }
}

export const store = new TaskStore();
