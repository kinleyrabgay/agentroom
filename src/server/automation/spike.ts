import type { SpikeRule } from '../../shared/types/index.js';

/** Event count of one Sentry issue at a point in time (ms). */
export interface CountSample {
  at: number;
  count: number;
}

export type CountHistory = Record<string, CountSample[]>;

/** Keep at most a day of samples per issue (and only for issues still listed). */
const KEEP_MS = 26 * 60 * 60 * 1000;
const MAX_SAMPLES = 400;

/** Add the current counts to the history, dropping old samples and issues no longer listed. */
export function recordCounts(history: CountHistory | undefined, issues: { id: string; count: number }[], now: number): CountHistory {
  const next: CountHistory = {};
  for (const i of issues) {
    if (!Number.isFinite(i.count)) continue;
    const old = (history?.[i.id] ?? []).filter((s) => now - s.at <= KEEP_MS);
    next[i.id] = [...old, { at: now, count: i.count }].slice(-MAX_SAMPLES);
  }
  return next;
}

/** Latest sample at or before `t`, or null. */
function countAt(samples: CountSample[], t: number): number | null {
  let best: CountSample | null = null;
  for (const s of samples) if (s.at <= t && (!best || s.at > best.at)) best = s;
  return best ? best.count : null;
}

/**
 * A spike: events in the last window ≥ factor × events in the window before, and at least minEvents.
 * Needs two full windows of history, so a freshly connected Sentry never fires on old volume.
 */
export function spikeOf(samples: CountSample[] | undefined, now: number, rule: SpikeRule): { spike: boolean; recent: number; prior: number } | null {
  if (!samples?.length) return null;
  const w = rule.windowMin * 60_000;
  const current = countAt(samples, now);
  const atWindow = countAt(samples, now - w);
  const atPrior = countAt(samples, now - 2 * w);
  if (current === null || atWindow === null || atPrior === null) return null;
  const recent = Math.max(0, current - atWindow);
  const prior = Math.max(0, atWindow - atPrior);
  return { spike: recent >= rule.minEvents && recent >= rule.factor * Math.max(prior, 1), recent, prior };
}

export const DEFAULT_SPIKE: SpikeRule = { factor: 3, windowMin: 60, minEvents: 10 };
