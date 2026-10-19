import { ActorType } from '../../shared/enums.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuditEntry, AuditPage, AuditQuery } from '../../shared/types/index.js';
import { AUDIT_MEMORY_LIMIT, AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX } from '../config/constants.js';

export type NewAuditEntry = Omit<AuditEntry, 'id' | 'ts'> & { ts?: string };

/**
 * Append-only audit log (`.agentroom/runs/audit.jsonl`): commands, file writes, pushes,
 * PRs, GitHub writes, approvals and settings changes, with who decided them.
 * The newest entries are kept in memory; older ones are read from disk when a query reaches them.
 */
export class AuditService {
  /** Oldest first. */
  private recent: AuditEntry[] = [];
  /** True when the file holds more entries than `recent`. */
  private truncated = false;

  constructor(private readonly file: string, retentionDays: number, now = new Date()) {
    this.load(retentionDays, now);
  }

  record(input: NewAuditEntry): AuditEntry {
    const { ts, ...rest } = input;
    const entry: AuditEntry = { id: randomUUID(), ts: ts ?? new Date().toISOString(), ...rest };
    this.recent.push(entry);
    if (this.recent.length > AUDIT_MEMORY_LIMIT) {
      this.recent.splice(0, this.recent.length - AUDIT_MEMORY_LIMIT);
      this.truncated = true;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    return entry;
  }

  /** Newest first, filtered, paginated by `before` (ISO ts of the last entry seen). */
  query(q: AuditQuery = {}): AuditPage {
    const limit = Math.min(Math.max(1, q.limit ?? AUDIT_PAGE_DEFAULT), AUDIT_PAGE_MAX);
    const needle = q.q?.trim().toLowerCase();
    const match = (e: AuditEntry) =>
      (!q.kind || e.kind === q.kind) &&
      (!q.botId || e.botId === q.botId) &&
      (!q.goalId || e.goalId === q.goalId) &&
      (!q.before || e.ts < q.before) &&
      (!needle || `${e.summary}\n${e.actor.name}\n${JSON.stringify(e.detail ?? {})}`.toLowerCase().includes(needle));

    const scan = (rows: AuditEntry[]) => {
      const hits: AuditEntry[] = [];
      for (let i = rows.length - 1; i >= 0 && hits.length <= limit; i--) if (match(rows[i])) hits.push(rows[i]);
      return hits;
    };

    let hits = scan(this.recent);
    // Not enough in memory and older entries exist on disk: scan the whole file.
    if (hits.length <= limit && this.truncated) hits = scan(readJsonl(this.file));
    return { entries: hits.slice(0, limit), more: hits.length > limit };
  }

  /** Drop entries older than the retention window (rewrites the file) and load the rest. */
  private load(retentionDays: number, now: Date) {
    if (!fs.existsSync(this.file)) return;
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
    const all = readJsonl(this.file);
    const kept = all.filter((e) => e.ts >= cutoff);
    if (kept.length !== all.length) {
      fs.writeFileSync(this.file, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
    }
    this.truncated = kept.length > AUDIT_MEMORY_LIMIT;
    this.recent = kept.slice(-AUDIT_MEMORY_LIMIT);
  }
}

function readJsonl(file: string): AuditEntry[] {
  if (!fs.existsSync(file)) return [];
  const out: AuditEntry[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AuditEntry);
    } catch {
      // torn line
    }
  }
  return out;
}

/** Records an action the human took through the UI/API (approve a goal, assign a card, change settings…). */
export type HumanAudit = (
  kind: AuditEntry['kind'],
  summary: string,
  extra?: Pick<AuditEntry, 'goalId' | 'botId' | 'taskId' | 'detail' | 'decision'>,
) => void;

export function humanAudit(audit: AuditService, name: () => string): HumanAudit {
  return (kind, summary, extra = {}) => audit.record({ kind, actor: { type: ActorType.Human, name: name() }, summary, ...extra });
}
