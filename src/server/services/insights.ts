import { AgentEventType, AuditKind, GoalStatus, NotificationKind } from '../../shared/enums.js';
import type { AuditEntry, Goal, Insights, InsightsPeriod, LedgerEntry, Notification, StampedEvent } from '../../shared/types/index.js';

export const PERIOD_DAYS: Record<InsightsPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 86_400_000;

/** Readable buckets for why runs and goals fail; first match wins. */
const FAILURE_BUCKETS: [string, RegExp][] = [
  ['Budget reached', /budget|spend limit|max(imum)?[ _-]?(budget|usd|cost)/i],
  ['Approval denied or timed out', /denied|approval|permission|timed out waiting/i],
  ['Tests failing', /\btests?\b|spec|assert|expect\(|vitest|jest|karma|failing/i],
  ['Tool or command error', /exit code|command|ENOENT|EACCES|tool|timeout|timed out|crash/i],
];

export function failureBucket(text: string | undefined): string {
  if (!text) return 'Other';
  for (const [label, re] of FAILURE_BUCKETS) if (re.test(text)) return label;
  return 'Other';
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Local calendar date, YYYY-MM-DD. */
const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface InsightsInput {
  period: InsightsPeriod;
  now?: number;
  ledger: LedgerEntry[];
  goals: Goal[];
  notifications: Notification[];
  /** Permission requests/answers (only these event types are read). */
  events: StampedEvent[];
  audit: AuditEntry[];
  dailyCapUsd?: number;
}

/** Results, spend and failure reasons over a period, from the run ledger, goals, inbox, events and audit log. */
export function buildInsights(i: InsightsInput): Insights {
  const now = i.now ?? Date.now();
  const days = PERIOD_DAYS[i.period];
  // Whole local days: the period starts at midnight `days - 1` days ago.
  const today = new Date(now);
  const sinceMs = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1)).getTime();
  const inPeriod = (iso: string | undefined) => !!iso && Date.parse(iso) >= sinceMs;

  const rows = i.ledger.filter((r) => Date.parse(r.ts) >= sinceMs);
  const finished = i.goals.filter((g) => g.status === GoalStatus.Done && inPeriod(g.updatedAt));
  const failed = i.goals.filter((g) => g.status === GoalStatus.Failed && inPeriod(g.updatedAt));

  // "Without help": never blocked, never asked a question, no denied request.
  const helped = new Set<string>();
  for (const n of i.notifications) {
    if (n.goalId && (n.kind === NotificationKind.Blocked || n.kind === NotificationKind.Question)) helped.add(n.goalId);
  }
  for (const e of i.events) {
    if (e.type === AgentEventType.PermissionResolved && !e.allowed && e.goalId) helped.add(e.goalId);
  }
  const unaided = finished.filter((g) => !helped.has(g.id)).length;

  const spendUsd = round(rows.reduce((t, r) => t + r.costUsd, 0));
  const goalRows = rows.filter((r) => r.goalId);
  const goalCount = new Set(goalRows.map((r) => r.goalId)).size;
  const goalSpend = goalRows.reduce((t, r) => t + r.costUsd, 0);

  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = localDate(Date.parse(r.ts));
    byDay.set(d, (byDay.get(d) ?? 0) + r.costUsd);
  }
  const dailySpend: Insights['dailySpend'] = [];
  for (let k = days - 1; k >= 0; k--) {
    const date = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - k).getTime());
    dailySpend.push({ date, usd: round(byDay.get(date) ?? 0) });
  }

  // How long the human took to answer: permission requests and plan reviews.
  const waits: number[] = [];
  const asked = new Map<string, number>();
  for (const e of i.events) {
    if (e.type === AgentEventType.PermissionRequest) asked.set(e.requestId, e.ts);
    else if (e.type === AgentEventType.PermissionResolved) {
      const t = asked.get(e.requestId);
      if (t !== undefined && t >= sinceMs) waits.push(e.ts - t);
    }
  }
  for (const n of i.notifications) {
    if (n.kind !== NotificationKind.PlanReady || !n.goalId || n.ts < sinceMs) continue;
    const g = i.goals.find((x) => x.id === n.goalId);
    const approved = g?.approvedAt ? Date.parse(g.approvedAt) : NaN;
    if (Number.isFinite(approved) && approved > n.ts) waits.push(approved - n.ts);
  }

  // PRs: opened from the audit log; merged only when goals record their PR.
  const prsOpened = i.audit.filter((a) => a.kind === AuditKind.PullRequest && a.decision !== 'denied' && inPeriod(a.ts)).length;
  const withPr = i.goals.filter((g) => inPeriod(g.updatedAt) && prOf(g));
  const prsMerged = withPr.length ? withPr.filter((g) => prOf(g)?.merged).length : undefined;

  const bots = new Map<string, { runs: number; ok: number; counted: number; cost: number; ms: number }>();
  for (const r of rows) {
    const b = bots.get(r.botId) ?? { runs: 0, ok: 0, counted: 0, cost: 0, ms: 0 };
    b.runs++;
    b.cost += r.costUsd;
    b.ms += r.durationMs;
    // Runs the human stopped don't count for or against success.
    if (!r.aborted) {
      b.counted++;
      if (r.ok) b.ok++;
    }
    bots.set(r.botId, b);
  }

  const reasons = new Map<string, number>();
  for (const r of rows) if (!r.ok && !r.aborted) bump(reasons, failureBucket(r.error));
  for (const g of failed) bump(reasons, failureBucket(g.reason));

  const skills = new Map<string, { runs: number; ok: number }>();
  for (const r of rows) {
    for (const s of r.skills ?? []) {
      const v = skills.get(s) ?? { runs: 0, ok: 0 };
      v.runs++;
      if (r.ok) v.ok++;
      skills.set(s, v);
    }
  }

  return {
    period: i.period,
    since: new Date(sinceMs).toISOString(),
    goalsFinished: finished.length,
    goalsFailed: failed.length,
    finishedWithoutHelpPct: finished.length ? Math.round((unaided / finished.length) * 100) : null,
    spendUsd,
    spendPerGoal: goalCount ? round(goalSpend / goalCount) : null,
    dailySpend,
    ...(i.dailyCapUsd ? { dailyCapUsd: i.dailyCapUsd } : {}),
    approvalWaitMedianMs: median(waits),
    prsOpened,
    ...(prsMerged !== undefined ? { prsMerged } : {}),
    perBot: [...bots.entries()]
      .map(([botId, b]) => ({
        botId,
        runs: b.runs,
        successRate: b.counted ? b.ok / b.counted : 0,
        costUsd: round(b.cost),
        avgDurationMs: Math.round(b.ms / b.runs),
      }))
      .sort((a, b) => b.runs - a.runs),
    failureReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    skills: [...skills.entries()]
      .map(([skill, v]) => ({ skill, runs: v.runs, successRate: v.ok / v.runs }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 12),
  };
}

/** A goal's PR, if a later version of the goal records one (`pr` with `merged`/`state`). */
function prOf(g: Goal): { merged: boolean } | null {
  const pr = (g as Goal & { pr?: { merged?: boolean; state?: string; mergedAt?: string } }).pr;
  if (!pr) return null;
  return { merged: !!pr.merged || pr.state === 'merged' || pr.state === 'MERGED' || !!pr.mergedAt };
}

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1);
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
