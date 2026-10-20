import { GoalStatus } from '../../shared/enums.js';
import type { Goal } from '../../shared/types/index.js';

/** What changed about a goal since the last look. */
export type GoalChange =
  | { kind: 'created'; goal: Goal }
  | { kind: 'status'; goal: Goal; from: GoalStatus }
  | { kind: 'pr'; goal: Goal };

type Listener = (change: GoalChange) => void;

/**
 * Turns "the board changed" into goal-level events (new goal, status moved, PR opened) for
 * integrations that report back outside AgentRoom (Teams updates, Linear/Jira status sync).
 * Cheap to call often: it only diffs status and PR url per goal.
 */
export class GoalWatch {
  private seen: Map<string, { status: GoalStatus; pr?: string }> | null = null;
  private listeners: Listener[] = [];

  on(fn: Listener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Diff against the previous look. The first call only primes (no events for goals that already exist). */
  check(goals: Goal[]) {
    const prev = this.seen;
    const next = new Map<string, { status: GoalStatus; pr?: string }>();
    const changes: GoalChange[] = [];
    for (const g of goals) {
      next.set(g.id, { status: g.status, ...(g.pr?.url ? { pr: g.pr.url } : {}) });
      if (!prev) continue;
      const before = prev.get(g.id);
      if (!before) {
        changes.push({ kind: 'created', goal: g });
        continue;
      }
      if (before.status !== g.status) changes.push({ kind: 'status', goal: g, from: before.status });
      if (g.pr?.url && before.pr !== g.pr.url) changes.push({ kind: 'pr', goal: g });
    }
    this.seen = next;
    for (const c of changes) {
      for (const l of this.listeners) {
        try {
          l(c);
        } catch {
          // a broken listener never stops the board from updating
        }
      }
    }
  }
}

/** The goal just started building (plan approved, or it skipped approval). */
export const startedBuilding = (c: GoalChange) =>
  c.kind === 'status' && c.goal.status === GoalStatus.Building && (c.from === GoalStatus.AwaitingApproval || c.from === GoalStatus.Planning);
