import { TaskSchema } from '../../shared/schemas.js';
import type { NewTaskInput, Task, TaskPatch } from '../../shared/types/index.js';
import { applyPatch, nextId, type BoardStore, type Clearable } from './board.store.js';

const TASK_PREFIX = 'T-';
const CLEARABLE = ['assignee', 'blockedReason', 'goalId'] as const;

export type TaskUpdate = Clearable<TaskPatch>;
export interface TaskFilter {
  goalId?: string;
}

export interface TaskRepository {
  list(filter?: TaskFilter): Task[];
  get(id: string): Task | undefined;
  create(input: NewTaskInput): Task;
  /** `null`/`""` clear assignee, blockedReason, goalId. */
  update(id: string, patch: TaskUpdate): Task;
  /** Append a progress note to the task's log. */
  appendLog(id: string, by: string, text: string): Task;
  /** Tick acceptance criteria by index. */
  tickAcceptance(id: string, indexes: number[], done?: boolean): Task;
  delete(id: string): void;
  deleteWhere(pred: (t: Task) => boolean): number;
}

export class FsTaskRepository implements TaskRepository {
  constructor(private readonly store: BoardStore) {}

  list(filter: TaskFilter = {}): Task[] {
    const tasks = this.store.read().tasks;
    return filter.goalId ? tasks.filter((t) => t.goalId === filter.goalId) : tasks;
  }

  get(id: string): Task | undefined {
    return this.store.read().tasks.find((t) => t.id === id);
  }

  create(input: NewTaskInput): Task {
    return this.store.mutate((board) => {
      const now = new Date().toISOString();
      const siblings = board.tasks.filter((t) => t.goalId === input.goalId);
      const task = TaskSchema.parse({
        ...stripUndefined(input),
        id: nextId(TASK_PREFIX, board.tasks.map((t) => t.id)),
        order: input.order ?? Math.max(0, ...siblings.map((t) => t.order)) + 1,
        acceptance: (input.acceptance ?? []).map((a) => (typeof a === 'string' ? { text: a, done: false } : a)),
        createdAt: now,
        updatedAt: now,
      });
      board.tasks.push(task);
      return task;
    });
  }

  update(id: string, patch: TaskUpdate): Task {
    return this.modify(id, (t) => applyPatch(t, patch, CLEARABLE));
  }

  appendLog(id: string, by: string, text: string): Task {
    return this.modify(id, (t) => ({ ...t, log: [...t.log, { ts: new Date().toISOString(), by, text }] }));
  }

  tickAcceptance(id: string, indexes: number[], done = true): Task {
    return this.modify(id, (t) => ({
      ...t,
      acceptance: t.acceptance.map((a, i) => (indexes.includes(i) ? { ...a, done } : a)),
    }));
  }

  delete(id: string): void {
    this.deleteWhere((t) => t.id === id);
  }

  deleteWhere(pred: (t: Task) => boolean): number {
    return this.store.mutate((board) => {
      const before = board.tasks.length;
      board.tasks = board.tasks.filter((t) => !pred(t));
      // Drop dangling dependencies on deleted tasks.
      const ids = new Set(board.tasks.map((t) => t.id));
      for (const t of board.tasks) t.dependsOn = t.dependsOn.filter((d) => ids.has(d));
      return before - board.tasks.length;
    });
  }

  private modify(id: string, fn: (t: Task) => Task): Task {
    return this.store.mutate((board) => {
      const i = board.tasks.findIndex((t) => t.id === id);
      if (i < 0) throw new Error(`task "${id}" not found`);
      const next = TaskSchema.parse({ ...fn(board.tasks[i]), id, createdAt: board.tasks[i].createdAt, updatedAt: new Date().toISOString() });
      board.tasks[i] = next;
      return next;
    });
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}
