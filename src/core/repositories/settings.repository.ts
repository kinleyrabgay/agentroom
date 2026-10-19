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
      next = SettingsSchema.parse(deepMerge(this.get(), patch));
    } catch (err) {
      throw new Error(`Invalid settings: ${describe(err)}`);
    }
    writeJson(this.file, next);
    return next;
  }
}

function describe(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return (err as Error).message;
}
