import fs from 'node:fs';
import { ConfigSchema } from '../../shared/schemas.js';
import type { Config } from '../../shared/types/index.js';
import { readJson, writeJson } from '../fs/json.js';

export type ConfigScope = 'team' | 'personal';

export interface ConfigRepository {
  /** Team config with your personal overrides on top. */
  get(): Config;
  /** Personal by default (port, permission mode, model, provider are your own choice). */
  update(patch: Partial<Config>, scope?: ConfigScope): Config;
}

/**
 * `.agentroom/config.json` (committed) plus `runs/config.local.json` (yours). The local file only
 * holds the keys you set, so team changes to everything else still reach you.
 */
export class FsConfigRepository implements ConfigRepository {
  constructor(
    private readonly file: string,
    private readonly localFile?: string,
  ) {}

  get(): Config {
    return ConfigSchema.parse({ ...readJson(this.file, {}), ...this.local() });
  }

  update(patch: Partial<Config>, scope: ConfigScope = 'personal'): Config {
    if (scope === 'personal' && this.localFile) {
      const local = { ...this.local(), ...patch };
      ConfigSchema.parse({ ...readJson(this.file, {}), ...local });
      writeJson(this.localFile, local);
      return this.get();
    }
    const next = ConfigSchema.parse({ ...readJson(this.file, {}), ...patch });
    writeJson(this.file, next);
    return this.get();
  }

  private local(): Record<string, unknown> {
    if (!this.localFile || !fs.existsSync(this.localFile)) return {};
    const raw = readJson<unknown>(this.localFile, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  }
}
