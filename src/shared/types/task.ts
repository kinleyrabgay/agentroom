import type { z } from 'zod';
import type { AcceptanceItemSchema, BoardSchema, GoalSchema, TaskLogEntrySchema, TaskSchema } from '../schemas.js';

export type Task = z.infer<typeof TaskSchema>;
export type AcceptanceItem = z.infer<typeof AcceptanceItemSchema>;
export type TaskLogEntry = z.infer<typeof TaskLogEntrySchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Board = z.infer<typeof BoardSchema>;

export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt'>>;
export type GoalPatch = Partial<Pick<Goal, 'title' | 'plan' | 'securityReview'>> & {
  /** Per-goal budget in USD; null clears it (back to the team default). */
  budgetUsd?: number | null;
};

export interface NewTaskInput {
  title: string;
  kind?: Task['kind'];
  goalId?: string;
  order?: number;
  assignee?: string;
  description?: string;
  acceptance?: (string | AcceptanceItem)[];
  files?: string[];
  dependsOn?: string[];
  notes?: string;
  createdBy?: string;
  /** Multi-repo rooms: room repo id; unset = primary repo. */
  repo?: string;
}

/** Per-repo state of a goal that spans repos (multi-repo rooms). */
export type GoalRepoState = NonNullable<Goal['repos']>[string];
