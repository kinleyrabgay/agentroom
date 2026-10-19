import fs from 'node:fs';
import path from 'node:path';
import type { IntegrationSecrets, IntegrationStatus } from '../../shared/types/index.js';
import { readJson } from '../../core/fs/json.js';

const FILE_MODE = 0o600;

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
