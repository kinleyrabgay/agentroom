import type { Goal } from './task.js';

export type ReviewComment = Goal['reviewComments'][number];

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/** One file in a goal's diff (its branch vs the commit it started from, plus anything not committed yet). */
export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  /** Unified diff of this file (bounded). */
  diff: string;
  /** The diff was cut to stay small. */
  truncated: boolean;
  /** Changed in the folder but not committed yet. */
  uncommitted: boolean;
}

/** Files grouped by the task whose checkpoint commits changed them. */
export interface ChangeGroup {
  /** Task id, or null for changes not tied to a task (uncommitted, or commits made outside a task). */
  taskId: string | null;
  title: string;
  commits: string[];
  files: string[];
  reverted?: boolean;
}

export interface GoalChanges {
  goalId: string;
  base: string | null;
  branch: string | null;
  /** Folder the goal works in (its worktree, or the project root). */
  cwd: string;
  files: ChangedFile[];
  groups: ChangeGroup[];
  additions: number;
  deletions: number;
  /** Multi-repo workspaces: the repo these changes are in (unset = primary). */
  repo?: string;
}

/** Prefilled pull request for a goal, with the checks the human should see before pushing. */
export interface PrDraft {
  title: string;
  body: string;
  branch: string | null;
  /** Open security findings on the goal. */
  openFindings: number;
  /** Short test summary, e.g. "QA passed (3 tasks)"; null when unknown. */
  tests: string | null;
  /** Multi-repo workspaces: the repo this PR is for (unset = primary). */
  repo?: string;
}

/** Today's spend and the caps, for the top bar and goal headers. */
export interface BudgetSummary {
  spentToday: number;
  perDayUsd: number | null;
  perGoalUsd: number | null;
  warnAt: number;
  /** Spend and effective cap per goal id. */
  goals: Record<string, { spent: number; cap: number | null }>;
}
