import type { Schedule, Trigger } from '../../shared/types/index.js';
import { nextCronRun } from './time-parse.js';

/** A one-off (or a repeat that was due while AgentRoom was off) older than this is skipped as missed. */
export const MISSED_AFTER_MS = 12 * 60 * 60 * 1000;

export interface ScheduleState {
  lastRunAt?: string;
  /** When it should run next (persisted, so a restart neither double-fires nor forgets). */
  nextRunAt?: string;
  lastOutcome?: 'started' | 'skipped' | 'failed';
}

export type Decision =
  | { action: 'wait'; nextRunAt: string | null }
  | { action: 'fire'; nextRunAt: string | null; disable: boolean }
  | { action: 'missed'; nextRunAt: string | null; disable: boolean; dueAt: string };

/** First due time of a schedule that hasn't run yet. */
export function firstRun(s: Schedule, now: Date): string | null {
  if (s.when.type === 'once') return s.when.at;
  return nextCronRun(s.when.cron, new Date(Math.max(Date.parse(s.createdAt) || 0, now.getTime() - 1000)));
}

/**
 * What to do with a schedule at `now`: wait, fire, or record a miss (AgentRoom was off for too long).
 * Pure: the caller persists `nextRunAt` and history.
 */
export function decide(s: Schedule, state: ScheduleState, now: Date): Decision {
  if (!s.enabled) return { action: 'wait', nextRunAt: null };
  if (s.when.type === 'once') {
    if (state.lastRunAt) return { action: 'wait', nextRunAt: null };
    const due = Date.parse(s.when.at);
    if (now.getTime() < due) return { action: 'wait', nextRunAt: s.when.at };
    if (now.getTime() - due > MISSED_AFTER_MS) return { action: 'missed', nextRunAt: null, disable: true, dueAt: s.when.at };
    return { action: 'fire', nextRunAt: null, disable: true };
  }
  const next = state.nextRunAt ?? firstRun(s, now);
  if (!next) return { action: 'wait', nextRunAt: null };
  if (now.getTime() < Date.parse(next)) return { action: 'wait', nextRunAt: next };
  const after = nextCronRun(s.when.cron, now);
  if (now.getTime() - Date.parse(next) > MISSED_AFTER_MS) return { action: 'missed', nextRunAt: after, disable: false, dueAt: next };
  return { action: 'fire', nextRunAt: after, disable: false };
}

/** "HH:MM" → minutes since midnight. */
const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Inside quiet hours (handles windows across midnight, e.g. 22:00–07:00). */
export function inQuietHours(q: { from: string; to: string } | undefined, now: Date): boolean {
  if (!q) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const from = minutes(q.from);
  const to = minutes(q.to);
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

/** Why a trigger may not fire right now, or null. */
export function triggerBlocked(t: Trigger, runsToday: number, now: Date): string | null {
  if (!t.enabled) return 'Trigger is off';
  if (t.runner === 'cloud') return 'Cloud runner is not available yet';
  if (runsToday >= t.limits.maxRunsPerDay) return `Reached ${t.limits.maxRunsPerDay} runs today`;
  if (inQuietHours(t.limits.quietHours, now)) return `Quiet hours (${t.limits.quietHours!.from}–${t.limits.quietHours!.to})`;
  return null;
}

/** Local calendar day, "YYYY-MM-DD". */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Sentry issues not seen before. On the first look nothing fires: everything is just remembered. */
export function newSentryIssues<T extends { id: string }>(issues: T[], seen: string[] | undefined): { fresh: T[]; seen: string[] } {
  const ids = issues.map((i) => i.id);
  if (!seen) return { fresh: [], seen: ids };
  const known = new Set(seen);
  const fresh = issues.filter((i) => !known.has(i.id));
  // Keep the memory bounded.
  return { fresh, seen: [...new Set([...ids, ...seen])].slice(0, 500) };
}

/** GitHub cards whose status changed into `status` since the last snapshot. First look only snapshots. */
export function movedCards<T extends { id: string; status?: string | null }>(
  items: T[],
  snapshot: Record<string, string> | undefined,
): { moved: T[]; snapshot: Record<string, string> } {
  const next: Record<string, string> = {};
  for (const i of items) next[i.id] = i.status ?? '';
  if (!snapshot) return { moved: [], snapshot: next };
  // Cards new to the board count as moved only if they appear straight into a column (not on first look).
  const moved = items.filter((i) => i.id in snapshot && snapshot[i.id] !== (i.status ?? ''));
  return { moved, snapshot: next };
}
