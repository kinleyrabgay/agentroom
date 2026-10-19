import fs from 'node:fs';
import { ZodError } from 'zod';
import { SettingsSchema } from '../../shared/schemas.js';
import type { Settings, SettingsPatch } from '../../shared/types/index.js';
import { deepMerge } from '../fs/deep-merge.js';
import { readJson, writeJson } from '../fs/json.js';

export interface SettingsRepository {
  get(): Settings;
  /** Deep-merge a partial update, validate, persist. Throws a readable Error on invalid input. */
  update(patch: SettingsPatch): Settings;
}

/** `.agentroom/settings.json` — team-wide settings, committed. Missing file = all defaults. */
export class FsSettingsRepository implements SettingsRepository {
  constructor(private readonly file: string) {}

  get(): Settings {
    if (!fs.existsSync(this.file)) return SettingsSchema.parse({});
    try {
      return SettingsSchema.parse(readJson(this.file, {}));
    } catch (err) {
      throw new Error(`Invalid ${this.file}: ${describe(err)}`);
    }
  }

  update(patch: SettingsPatch): Settings {
    let next: Settings;
    try {
      next = SettingsSchema.parse(deepMerge(withReplacedPhases(this.get(), patch), patch));
    } catch (err) {
      throw new Error(`Invalid settings: ${describe(err)}`);
    }
    writeJson(this.file, next);
    return next;
  }
}

/**
 * A phase's model/effort is one choice: the patch's phase object replaces the stored one instead of
 * merging into it, so `{ models: { build: {} } }` clears Build back to "bot's own setting".
 */
function withReplacedPhases(current: Settings, patch: SettingsPatch): Settings {
  if (!patch.models) return current;
  const models = { ...current.models };
  for (const phase of Object.keys(patch.models) as (keyof Settings['models'])[]) models[phase] = {};
  return { ...current, models };
}

function describe(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return (err as Error).message;
}
