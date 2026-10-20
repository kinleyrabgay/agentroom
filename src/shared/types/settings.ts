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
  /** Linear personal API key. */
  linearApiKey?: string;
  /** Jira Cloud account email + API token. */
  jiraEmail?: string;
  jiraToken?: string;
  /** Security token (base64 HMAC key) of the Teams outgoing webhook. */
  teamsOutgoingSecret?: string;
  /** HMAC key that signs team room member links. Rotating it invalidates every link. */
  roomSecret?: string;
  /** API keys for providers besides Claude (e.g. `openai-compat`). Never returned over the API. */
  providers?: Record<string, string>;
}

/** What GET /api/integrations returns: which secrets are set, never their values. */
export interface IntegrationStatus {
  slack: boolean;
  teams: boolean;
  email: boolean;
}
