import fs from 'node:fs';
import { ZodError } from 'zod';
import { SettingsSchema } from '../../shared/schemas.js';
import type { Settings, SettingsPatch } from '../../shared/types/index.js';
import { deepMerge } from '../fs/deep-merge.js';
import { readJson, writeJson } from '../fs/json.js';

export type SettingsScope = 'team' | 'personal';

export interface SettingsRepository {
  /** Team settings with your personal overrides on top (what AgentRoom uses). */
  get(): Settings;
  /** Team settings only (`.agentroom/settings.json`). */
  team(): Settings;
  /**
   * Deep-merge a partial update, validate, persist. `team` (default) writes the committed file;
   * `personal` writes only the changed keys to your local overlay. Throws a readable Error on invalid input.
   */
  update(patch: SettingsPatch, scope?: SettingsScope): Settings;
  /** Dotted keys you've overridden personally, e.g. "models.build", "budgets.perDayUsd". */
  overrides(): string[];
  /** Drop a personal override so the team value applies again. Returns the merged settings. */
  resetPersonal(key: string): Settings;
}

/**
 * `.agentroom/settings.json` is the team's (committed); `runs/settings.local.json` holds your personal
 * overrides (only the keys you changed). Missing files = defaults / no overrides.
 */
export class FsSettingsRepository implements SettingsRepository {
  constructor(
    private readonly file: string,
    private readonly localFile?: string,
  ) {}

  team(): Settings {
    if (!fs.existsSync(this.file)) return SettingsSchema.parse({});
    try {
      return SettingsSchema.parse(readJson(this.file, {}));
    } catch (err) {
      throw new Error(`Invalid ${this.file}: ${describe(err)}`);
    }
  }

  get(): Settings {
    const local = this.local();
    if (!Object.keys(local).length) return this.team();
    try {
      return SettingsSchema.parse(deepMerge(withReplacedPhases(this.team(), local), local));
    } catch (err) {
      console.error(`[agentroom] Ignoring invalid personal settings (${this.localFile}): ${describe(err)}`);
      return this.team();
    }
  }

  update(patch: SettingsPatch, scope: SettingsScope = 'team'): Settings {
    if (scope === 'personal' && this.localFile) {
      const local = deepMerge(withReplacedPhases(this.local() as Settings, patch), patch) as Record<string, unknown>;
      try {
        SettingsSchema.parse(deepMerge(withReplacedPhases(this.team(), local), local));
      } catch (err) {
        throw new Error(`Invalid settings: ${describe(err)}`);
      }
      writeJson(this.localFile, local);
      return this.get();
    }
    let next: Settings;
    try {
      next = SettingsSchema.parse(deepMerge(withReplacedPhases(this.team(), patch), patch));
    } catch (err) {
      throw new Error(`Invalid settings: ${describe(err)}`);
    }
    writeJson(this.file, next);
    return this.get();
  }

  overrides(): string[] {
    return leafKeys(this.local());
  }

  resetPersonal(key: string): Settings {
    if (!this.localFile) return this.get();
    const local = this.local();
    removePath(local, key.split('.'));
    writeJson(this.localFile, local);
    return this.get();
  }

  private local(): Record<string, unknown> {
    if (!this.localFile || !fs.existsSync(this.localFile)) return {};
    const raw = readJson<unknown>(this.localFile, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Dotted paths of the overridden values. A phase choice under `models` counts as one key. */
export function leafKeys(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (prefix === 'models' || !isObj(v) || !Object.keys(v).length) return [key];
    return leafKeys(v, key);
  });
}

/** Delete a dotted path and any objects it leaves empty. */
function removePath(o: Record<string, unknown>, parts: string[]) {
  const [head, ...rest] = parts;
  if (!head || !(head in o)) return;
  if (!rest.length) {
    delete o[head];
    return;
  }
  const child = o[head];
  if (!isObj(child)) return;
  removePath(child, rest);
  if (!Object.keys(child).length) delete o[head];
}

/**
 * A phase's model/effort is one choice: the patch's phase object replaces the stored one instead of
 * merging into it, so `{ models: { build: {} } }` clears Build back to "bot's own setting".
 */
function withReplacedPhases(current: Settings, patch: SettingsPatch | Record<string, unknown>): Settings {
  const pm = (patch as SettingsPatch).models;
  if (!pm) return current;
  const models = { ...current.models };
  for (const phase of Object.keys(pm) as (keyof Settings['models'])[]) models[phase] = {};
  return { ...current, models };
}

function describe(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return (err as Error).message;
}
