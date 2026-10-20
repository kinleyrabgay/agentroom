import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GoalStatus } from '../../shared/enums.js';
import type { Goal, GoalOutcome, LedgerEntry, OutcomeLabel } from '../../shared/types/index.js';
import { readJson } from '../../core/fs/json.js';

/** Read-only lookups the outcome tracker needs; injectable for tests. */
export interface OutcomeProbe {
  /** `gh pr view <url> --json state,mergedAt,mergeCommit` (read-only). Null when gh isn't available. */
  pr(url: string): Promise<{ state: string; mergedAt?: string | null; mergeCommit?: { oid?: string } | null } | null>;
  /** Commit that reverted `sha` on any local branch, or null. */
  revertOf(sha: string): Promise<string | null>;
}

const run = (cmd: string, args: string[], cwd: string) =>
  new Promise<string | null>((resolve) => {
    execFile(cmd, args, { cwd, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout.toString()));
  });

export function cliProbe(root: string): OutcomeProbe {
  return {
    async pr(url) {
      const out = await run('gh', ['pr', 'view', url, '--json', 'state,mergedAt,mergeCommit'], root);
      if (!out) return null;
      try {
        return JSON.parse(out) as Awaited<ReturnType<OutcomeProbe['pr']>>;
      } catch {
        return null;
      }
    },
    async revertOf(sha) {
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;
      const out = await run('git', ['log', '--all', '-n', '1', '--format=%H', '-F', `--grep=This reverts commit ${sha}`], root);
      return out?.trim() || null;
    },
  };
}

const FINAL: ReadonlySet<string> = new Set([GoalStatus.Done, GoalStatus.Failed, GoalStatus.Cancelled]);
/** Re-check open PRs at most this often. */
const RECHECK_MS = 60 * 60 * 1000;

/**
 * What happened to each goal after it finished: PR merged or closed, reverted later, how many fix
 * rounds it took, what it cost. Stored locally in `runs/outcomes.json`; refreshed on demand.
 */
export class OutcomeTracker {
  private cache: Record<string, GoalOutcome>;

  constructor(
    private readonly file: string,
    private readonly probe: OutcomeProbe,
  ) {
    this.cache = readJson<Record<string, GoalOutcome>>(file, {});
  }

  get(goalId: string): GoalOutcome | undefined {
    return this.cache[goalId];
  }

  all(): GoalOutcome[] {
    return Object.values(this.cache);
  }

  /** Update outcomes of finished goals. With `remote` false, only local facts (status, cost, rounds). */
  async refresh(goals: Goal[], ledger: LedgerEntry[], o: { remote: boolean; now?: Date }): Promise<GoalOutcome[]> {
    const now = o.now ?? new Date();
    const cost = new Map<string, number>();
    for (const r of ledger) if (r.goalId) cost.set(r.goalId, (cost.get(r.goalId) ?? 0) + r.costUsd);
    for (const g of goals) {
      if (!FINAL.has(g.status)) continue;
      const prev = this.cache[g.id];
      const next: GoalOutcome = {
        goalId: g.id,
        status: g.status,
        reviewRounds: Math.max(0, (g.round ?? 0) - 1) + (g.reviewComments?.some((c) => c.sent) ? 1 : 0),
        costUsd: Math.round((cost.get(g.id) ?? 0) * 1e6) / 1e6,
        checkedAt: prev?.checkedAt ?? now.toISOString(),
        ...(prev?.prState ? { prState: prev.prState } : {}),
        ...(prev?.mergedAt ? { mergedAt: prev.mergedAt } : {}),
        ...(prev?.reverted ? { reverted: prev.reverted } : {}),
      };
      const stale = !prev || now.getTime() - Date.parse(prev.checkedAt) > RECHECK_MS || prev.prState === undefined;
      const settled = prev?.prState === 'closed' || prev?.reverted;
      if (o.remote && g.pr?.url && stale && !settled) {
        const pr = await this.probe.pr(g.pr.url);
        if (pr) {
          next.prState = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open';
          if (pr.mergedAt) next.mergedAt = pr.mergedAt;
          const oid = pr.mergeCommit?.oid;
          if (next.prState === 'merged' && oid) next.reverted = !!(await this.probe.revertOf(oid));
        }
        next.checkedAt = now.toISOString();
      }
      this.cache[g.id] = next;
    }
    this.save();
    return this.all();
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.cache, null, 2) + '\n');
  }
}

/** success: finished and kept (merged, or no PR and not reverted); failure: failed, cancelled, closed unmerged or reverted. */
export function outcomeLabel(o: GoalOutcome | undefined): OutcomeLabel {
  if (!o) return 'pending';
  if (o.status !== GoalStatus.Done) return 'failure';
  if (o.reverted || o.prState === 'closed') return 'failure';
  if (o.prState === 'open') return 'pending';
  return 'success';
}
