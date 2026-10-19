import fs from 'node:fs';
import path from 'node:path';
import type { StampedEvent } from '../../shared/types/index.js';

/** Event logs are one file per server start, named by ISO time (e.g. 2026-10-19T11-18-02-025Z.jsonl). */
const LOG_NAME = /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.jsonl$/;
/** Never hold more than this many events in memory for one query. */
const MAX_EVENTS = 20_000;

/**
 * Read stamped events back from the run logs: those of one goal, and/or since a time.
 * Lines are pre-filtered by substring before parsing, so large logs stay cheap.
 */
export function readEvents(runsDir: string, opts: { goalId?: string; sinceMs?: number } = {}): StampedEvent[] {
  if (!fs.existsSync(runsDir)) return [];
  const needle = opts.goalId ? `"goalId":${JSON.stringify(opts.goalId)}` : null;
  const files = fs
    .readdirSync(runsDir)
    .filter((f) => LOG_NAME.test(f))
    .map((f) => path.join(runsDir, f))
    .filter((f) => !opts.sinceMs || safeMtime(f) >= opts.sinceMs)
    .sort();
  const out: StampedEvent[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line || (needle && !line.includes(needle))) continue;
      try {
        const e = JSON.parse(line) as StampedEvent;
        if (opts.sinceMs && e.ts < opts.sinceMs) continue;
        out.push(e);
      } catch {
        // torn line
      }
    }
    if (out.length > MAX_EVENTS) out.splice(0, out.length - MAX_EVENTS);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function safeMtime(file: string) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
