import { GoalSchema } from '../../shared/schemas.js';
import type { Goal, GoalSource } from '../../shared/types/index.js';
import { applyPatch, nextId, type BoardStore, type Clearable } from './board.store.js';

export interface NewGoalInput {
  title: string;
  brief: string;
  sources?: GoalSource[];
}

const GOAL_PREFIX = 'G-';
const CLEARABLE = ['feedback', 'reason', 'approvedAt'] as const;

/** Fields the engine (not the human) manages are included; REST exposes a narrower GoalPatch. */
export type GoalUpdate = Clearable<Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>>;

export interface GoalRepository {
  list(): Goal[];
  get(id: string): Goal | undefined;
  create(input: NewGoalInput): Goal;
  update(id: string, patch: GoalUpdate): Goal;
  /** Delete the goal and all of its tasks. */
  delete(id: string): void;
}

export class FsGoalRepository implements GoalRepository {
  constructor(private readonly store: BoardStore) {}

  list(): Goal[] {
    return this.store.read().goals;
  }

  get(id: string): Goal | undefined {
    return this.list().find((g) => g.id === id);
  }

  create(input: NewGoalInput): Goal {
    return this.store.mutate((board) => {
      const now = new Date().toISOString();
      const goal = GoalSchema.parse({ ...input, id: nextId(GOAL_PREFIX, board.goals.map((g) => g.id)), createdAt: now, updatedAt: now });
      board.goals.push(goal);
      return goal;
    });
  }

  update(id: string, patch: GoalUpdate): Goal {
    return this.store.mutate((board) => {
      const i = board.goals.findIndex((g) => g.id === id);
      if (i < 0) throw new Error(`goal "${id}" not found`);
      const next = GoalSchema.parse({ ...applyPatch(board.goals[i], patch, CLEARABLE), id, updatedAt: new Date().toISOString() });
      board.goals[i] = next;
      return next;
    });
  }

  delete(id: string): void {
    this.store.mutate((board) => {
      board.goals = board.goals.filter((g) => g.id !== id);
      board.tasks = board.tasks.filter((t) => t.goalId !== id);
    });
  }
}
