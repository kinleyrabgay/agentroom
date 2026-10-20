import type { z } from 'zod';
import type { ConfigSchema } from '../schemas.js';

export type Config = z.infer<typeof ConfigSchema>;

export interface ProjectInfo {
  root: string;
  name: string;
  branch: string | null;
  provider: string;
  model: string;
  config: Config;
  /** team: `.agentroom/` is committed (runs/ ignored); private: excluded for you only. */
  sharing?: 'team' | 'private';
}
