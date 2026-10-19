import type { McpScope, McpStatus } from '../enums.js';

/**
 * How to reach a server, in Claude Code's `.mcp.json` shape. String values in `env`, `headers` and `args`
 * may reference `${secret:NAME}` (from `.agentroom/runs/secrets.json`) or `${env:NAME}`.
 */
export type McpTransportConfig =
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  /** A claude.ai connector (signed in on claude.ai, so personal only). */
  | { type: 'claudeai-proxy'; url: string; id: string };

/** One server as stored in mcp.json. */
export interface McpServerEntry {
  /** Key in mcp.json; tools appear to bots as `mcp__<name>__<tool>`. */
  name: string;
  config: McpTransportConfig;
  /** Bot ids that get the server, or `['*']` for everyone. */
  bots: string[];
  enabled: boolean;
  /** Short note shown in the UI (what it's for). */
  description?: string;
  /** Preset it was created from, e.g. "sentry". */
  preset?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  /** The server marks the tool as read-only (it then runs without approval under ask-writes). */
  readOnly?: boolean;
}

/** A server AgentRoom manages, with its live state. */
export interface McpServerState extends McpServerEntry {
  scope: McpScope;
  status: McpStatus;
  error?: string;
  tools: McpTool[];
  server?: { name: string; version: string };
  /** `${secret:…}` names it needs that aren't set. */
  missingSecrets: string[];
  /** Secret names it references (set or not), so the UI can offer to change them. */
  secrets: string[];
}

/** A server set up in Claude Code (claude.ai connectors, user/project/local config, plugins). */
export interface McpAvailable {
  name: string;
  /** claudeai | user | project | local | plugin | … */
  source: string;
  status: McpStatus;
  type: string;
  url?: string;
  toolCount: number;
  /** Already added to AgentRoom under this name. */
  added?: string;
}

export interface McpSnapshot {
  servers: McpServerState[];
  available: McpAvailable[];
  /** ISO time of the last status check, or null if never. */
  checkedAt: string | null;
  checking: boolean;
  /** A sign-in started from the UI, waiting for the browser callback. */
  signingIn?: string;
}

/** A ready-made server the UI offers in "Add server". */
export interface McpPreset {
  id: string;
  name: string;
  description: string;
  config: McpTransportConfig;
  /** Secrets the user must fill in (name → label/help). */
  secrets?: { name: string; label: string; help?: string; url?: string }[];
  /** Shown under the preset: how auth works. */
  auth: string;
  docs?: string;
}
