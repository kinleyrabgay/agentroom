import type { z } from 'zod';
import type { SettingsSchema } from '../schemas.js';

/** Team-wide settings, committed in `.agentroom/settings.json`. */
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> };

/** Personal/secret integration settings, local only (`.agentroom/runs/secrets.json`). Secrets are write-only over the API. */
export interface IntegrationSecrets {
  slackWebhook?: string;
  teamsWebhook?: string;
  smtp?: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string; to: string };
  /** Values for `${secret:NAME}` references in mcp.json (tokens, API keys). */
  mcp?: Record<string, string>;
}

/** What GET /api/integrations returns: which secrets are set, never their values. */
export interface IntegrationStatus {
  slack: boolean;
  teams: boolean;
  email: boolean;
}
