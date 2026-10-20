import fs from 'node:fs';
import path from 'node:path';
import type { IntegrationSecrets, IntegrationStatus } from '../../shared/types/index.js';
import { readJson } from '../../core/fs/json.js';

const FILE_MODE = 0o600;
export const MCP_SECRET = /^[A-Z][A-Z0-9_]{0,63}$/;
export type IntakeSecret = 'linearApiKey' | 'jiraEmail' | 'jiraToken' | 'teamsOutgoingSecret';

/**
 * Local integration secrets (`.agentroom/runs/secrets.json`, mode 0600, never committed).
 * Write-only over the API: callers only ever see which integrations are configured.
 */
export class SecretsStore {
  constructor(private readonly file: string) {}

  /** Full secrets, for server-side use only (digests). */
  read(): IntegrationSecrets {
    return readJson<IntegrationSecrets>(this.file, {});
  }

  status(): IntegrationStatus {
    const s = this.read();
    return { slack: !!s.slackWebhook, teams: !!s.teamsWebhook, email: !!s.smtp?.host };
  }

  /** Partial update. Empty string (or null for smtp) clears a value. */
  update(patch: Partial<Record<keyof IntegrationSecrets, unknown>>): IntegrationStatus {
    const next: IntegrationSecrets = { ...this.read() };
    for (const key of ['slackWebhook', 'teamsWebhook'] as const) {
      const v = patch[key];
      if (v === undefined) continue;
      if (v === '' || v === null) delete next[key];
      else next[key] = webhook(key, v);
    }
    if (patch.smtp !== undefined) {
      if (patch.smtp === null || patch.smtp === '' || (typeof patch.smtp === 'object' && !Object.keys(patch.smtp as object).length)) delete next.smtp;
      else next.smtp = smtp(patch.smtp);
    }
    this.write(next);
    return this.status();
  }

  /** Set (or with '' clear) one intake credential: tracker tokens, the Teams HMAC key. Never returned over the API. */
  setCredential(key: IntakeSecret, value: string) {
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    const next: IntegrationSecrets = { ...this.read() };
    const v = value.trim();
    if (!v) delete next[key];
    else next[key] = v;
    this.write(next);
  }

  /** Value for a `${secret:NAME}` reference in mcp.json, or undefined. */
  mcpSecret(name: string): string | undefined {
    return this.read().mcp?.[name];
  }

  /** Set (or with '' clear) MCP secrets. Values are never returned over the API. */
  setMcpSecrets(values: Record<string, string>) {
    const next = { ...this.read() };
    const mcp = { ...(next.mcp ?? {}) };
    for (const [k, v] of Object.entries(values)) {
      if (!MCP_SECRET.test(k)) throw new Error(`Invalid secret name "${k}" (use A-Z, 0-9 and _)`);
      if (typeof v !== 'string') throw new Error(`${k} must be a string`);
      if (v === '') delete mcp[k];
      else mcp[k] = v.trim();
    }
    if (Object.keys(mcp).length) next.mcp = mcp;
    else delete next.mcp;
    this.write(next);
  }

  /** Team room signing key (never sent over the API). */
  setRoomSecret(value: string) {
    this.write({ ...this.read(), roomSecret: value });
  }

  /** API key stored for a provider (codex, gemini, openai-compat), or undefined. */
  providerKey(id: string): string | undefined {
    return this.read().providers?.[id];
  }

  /** Providers that have a key stored (never the values). */
  providerKeys(): string[] {
    return Object.keys(this.read().providers ?? {});
  }

  /** Set (or with '' clear) a provider's API key. */
  setProviderKey(id: string, value: string) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error(`Invalid provider "${id}"`);
    if (typeof value !== 'string') throw new Error('key must be a string');
    const next = { ...this.read() };
    const providers = { ...(next.providers ?? {}) };
    if (value.trim() === '') delete providers[id];
    else providers[id] = value.trim();
    if (Object.keys(providers).length) next.providers = providers;
    else delete next.providers;
    this.write(next);
  }

  private write(value: IntegrationSecrets) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(value, null, 2) + '\n', { mode: FILE_MODE });
    fs.chmodSync(this.file, FILE_MODE);
  }
}

function webhook(key: string, v: unknown): string {
  if (typeof v !== 'string' || !/^https:\/\/\S+$/.test(v)) throw new Error(`${key} must be an https URL`);
  return v;
}

function smtp(v: unknown): NonNullable<IntegrationSecrets['smtp']> {
  const o = (v ?? {}) as Record<string, unknown>;
  const str = (k: string, required = true) => {
    const x = o[k];
    if (x === undefined || x === '') {
      if (required) throw new Error(`smtp.${k} is required`);
      return undefined;
    }
    if (typeof x !== 'string') throw new Error(`smtp.${k} must be a string`);
    return x;
  };
  const port = Number(o.port ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('smtp.port must be a valid port');
  return { host: str('host')!, port, secure: o.secure === true, user: str('user', false), pass: str('pass', false), from: str('from')!, to: str('to')! };
}
