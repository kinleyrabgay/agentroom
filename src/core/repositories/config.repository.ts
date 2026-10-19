import { ConfigSchema } from '../../shared/schemas.js';
import type { Config } from '../../shared/types/index.js';
import { readJson, writeJson } from '../fs/json.js';

export interface ConfigRepository {
  get(): Config;
  update(patch: Partial<Config>): Config;
}

export class FsConfigRepository implements ConfigRepository {
  constructor(private readonly file: string) {}

  get(): Config {
    return ConfigSchema.parse(readJson(this.file, {}));
  }

  update(patch: Partial<Config>): Config {
    const next = ConfigSchema.parse({ ...this.get(), ...patch });
    writeJson(this.file, next);
    return next;
  }
}
