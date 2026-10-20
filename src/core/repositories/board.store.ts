import fs from 'node:fs';
import { BoardSchema } from '../../shared/schemas.js';
import type { Board } from '../../shared/types/index.js';
import { writeJson } from '../fs/json.js';

export const BOARD_VERSION = 2;

/**
 * Reads and writes `runs/board.json` (local). Goals and tasks share one file so a plan and its
 * tasks change atomically and diff together in git. v1 files (a bare task array) are migrated on read.
 */
export class BoardStore {
  constructor(readonly file: string) {}

  read(): Board {
    if (!fs.existsSync(this.file)) return BoardSchema.parse({});
    const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    return BoardSchema.parse(Array.isArray(raw) ? { version: BOARD_VERSION, tasks: raw } : raw);
  }

  write(board: Board): void {
    writeJson(this.file, { ...board, version: BOARD_VERSION });
  }

  /** Read-modify-write in one step. */
  mutate<T>(fn: (board: Board) => T): T {
    const board = this.read();
    const result = fn(board);
    this.write(board);
    return result;
  }
}

/** Next id for a prefix, e.g. T-7 after T-6. */
export function nextId(prefix: string, ids: string[]): string {
  const n = Math.max(0, ...ids.map((id) => Number(id.slice(prefix.length)) || 0)) + 1;
  return `${prefix}${n}`;
}

/** `null` and `""` clear an optional field; `undefined` leaves it alone. */
export type Clearable<T> = { [K in keyof T]?: T[K] | null };

export function applyPatch<T extends object>(target: T, patch: object, clearable: readonly string[]): T {
  const out = { ...target } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null || (v === '' && clearable.includes(k))) {
      if (clearable.includes(k)) delete out[k];
      continue;
    }
    out[k] = v;
  }
  return out as T;
}
