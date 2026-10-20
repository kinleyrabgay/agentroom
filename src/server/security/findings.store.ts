import { createHash, randomUUID } from 'node:crypto';
import { AuditKind, FindingSeverity, FindingStatus, StateType, type FindingSource } from '../../shared/enums.js';
import type { AuditActor, FindingQuery, SecurityFinding } from '../../shared/types/index.js';
import { readJson, writeJson } from '../../core/fs/json.js';
import type { NewAuditEntry } from '../services/audit.service.js';
import type { Hub } from '../realtime/hub.js';
import type { FindingDraft, FindingScope } from './types.js';

/** Keep the file bounded: resolved/fixed findings beyond this are dropped oldest-first. */
const MAX_FINDINGS = 2000;

const RANK: Record<string, number> = { [FindingSeverity.Info]: 0, [FindingSeverity.Warning]: 1, [FindingSeverity.Critical]: 2 };

/** True when `severity` is at or above the blocking threshold (`none` never blocks). */
export function blocks(severity: SecurityFinding['severity'], threshold: 'critical' | 'warning' | 'none'): boolean {
  return threshold !== 'none' && RANK[severity] >= RANK[threshold];
}

export interface FindingsStoreDeps {
  file: string;
  hub?: Hub;
  audit?: (entry: NewAuditEntry) => void;
}

/**
 * Security findings for the project, in `.agentroom/runs/security.json`.
 * Rescans dedupe against existing findings and mark the ones that disappeared as fixed.
 */
export class FindingsStore {
  private items: SecurityFinding[];

  constructor(private readonly deps: FindingsStoreDeps) {
    this.items = readJson<SecurityFinding[]>(deps.file, []);
  }

  list(q: FindingQuery = {}): SecurityFinding[] {
    return this.items
      .filter(
        (f) =>
          (q.goalId === undefined || f.goalId === q.goalId) &&
          (q.repo === undefined || (f.repo ?? '') === q.repo) &&
          (!q.status || f.status === q.status) &&
          (!q.severity || f.severity === q.severity),
      )
      .sort((a, b) => b.ts.localeCompare(a.ts));
  }

  get(id: string): SecurityFinding | undefined {
    return this.items.find((f) => f.id === id);
  }

  /**
   * Record the results of a scan. With `replace`, open findings of those sources in the same scope
   * that this scan no longer reports are marked fixed. Returns the findings of this scan (with ids).
   */
  record(drafts: FindingDraft[], scope: FindingScope, replace?: { sources: FindingSource[] }): SecurityFinding[] {
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const out: SecurityFinding[] = [];
    for (const d of drafts) {
      const key = keyOf(scope.goalId, d, scope.repo);
      if (seen.has(key)) continue;
      seen.add(key);
      let f = this.items.find((x) => keyOf(x.goalId, x, x.repo) === key);
      if (f) {
        if (f.status === FindingStatus.Fixed) Object.assign(f, { status: FindingStatus.Open, ts: now, resolvedAt: undefined, resolvedBy: undefined });
        Object.assign(f, { title: d.title, detail: d.detail, severity: d.severity });
      } else {
        f = { ...d, id: randomUUID(), ts: now, status: FindingStatus.Open, ...stripUndefined(scope) };
        this.items.push(f);
      }
      out.push(f);
    }
    if (replace) {
      for (const f of this.items) {
        if (f.goalId === scope.goalId && (f.repo ?? '') === (scope.repo ?? '') && f.status === FindingStatus.Open && replace.sources.includes(f.source) && !seen.has(keyOf(f.goalId, f, f.repo))) {
          f.status = FindingStatus.Fixed;
          f.resolvedAt = now;
        }
      }
    }
    this.save();
    return out;
  }

  /** A human decision on a finding. */
  resolve(id: string, status: typeof FindingStatus.Approved | typeof FindingStatus.Dismissed, actor: AuditActor, note?: string): SecurityFinding {
    const f = this.get(id);
    if (!f) throw new Error(`finding "${id}" not found`);
    if (status !== FindingStatus.Approved && status !== FindingStatus.Dismissed) throw new Error('status must be "approved" or "dismissed"');
    Object.assign(f, { status, resolvedBy: actor, resolvedAt: new Date().toISOString(), ...(note ? { note } : {}) });
    this.deps.audit?.({
      kind: AuditKind.Security,
      actor,
      ...(f.goalId ? { goalId: f.goalId } : {}),
      ...(f.botId ? { botId: f.botId } : {}),
      summary: `${status === FindingStatus.Approved ? 'Accepted risk' : 'Dismissed'}: ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`,
      decision: 'allowed',
      detail: { findingId: f.id, rule: f.rule, severity: f.severity, ...(note ? { note } : {}) },
    });
    this.save();
    return f;
  }

  /** Open findings for a goal at/above a severity threshold (all repos, or only `repo`: '' = the primary repo). */
  openBlocking(goalId: string | undefined, threshold: 'critical' | 'warning' | 'none', repo?: string): SecurityFinding[] {
    return this.items.filter((f) => f.goalId === goalId && (repo === undefined || (f.repo ?? '') === repo) && f.status === FindingStatus.Open && blocks(f.severity, threshold));
  }

  /** Push the current findings to the UI. */
  push() {
    this.deps.hub?.state({ type: StateType.Findings, findings: this.list() });
  }

  private save() {
    if (this.items.length > MAX_FINDINGS) {
      const closed = this.items.filter((f) => f.status !== FindingStatus.Open).sort((a, b) => a.ts.localeCompare(b.ts));
      const drop = new Set(closed.slice(0, this.items.length - MAX_FINDINGS).map((f) => f.id));
      this.items = this.items.filter((f) => !drop.has(f.id));
    }
    writeJson(this.deps.file, this.items);
    this.push();
  }
}

function keyOf(goalId: string | undefined, d: Pick<SecurityFinding, 'rule' | 'file' | 'line' | 'snippet'>, repo?: string): string {
  const snippet = d.snippet ? createHash('sha1').update(d.snippet).digest('hex').slice(0, 12) : '';
  // The primary repo keeps the original key, so findings recorded before workspaces still dedupe.
  return [goalId ?? '', d.rule, d.file ?? '', d.line ?? '', snippet, ...(repo ? [repo] : [])].join('|');
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
