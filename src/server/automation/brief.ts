import { GoalStatus, NotificationKind } from '../../shared/enums.js';
import type { AutomationRun, Brief, BriefItem, Goal, LedgerEntry, Notification } from '../../shared/types/index.js';

export interface BriefInput {
  since: string;
  until: string;
  goals: Goal[];
  ledger: LedgerEntry[];
  notifications: Notification[];
  /** Permission requests waiting right now. */
  pendingApprovals: number;
  history: AutomationRun[];
  dailyCapUsd?: number;
}

const MAX_ITEMS = 5;
const inWindow = (ts: string | undefined, since: string, until: string) => !!ts && ts >= since && ts <= until;

/**
 * "While you were away": what finished, what's waiting, what it cost, for the window [since, until].
 * Waiting items are as of now (they still need you); finished/failed/PRs are what changed in the window.
 */
export function buildBrief(i: BriefInput): Brief {
  const changed = i.goals.filter((g) => inWindow(g.updatedAt, i.since, i.until));
  const done = changed.filter((g) => g.status === GoalStatus.Done);
  const failed = changed.filter((g) => g.status === GoalStatus.Failed);
  const prs = i.goals.filter((g) => g.pr && inWindow((g.pr as { createdAt?: string }).createdAt ?? g.updatedAt, i.since, i.until));
  const plans = i.goals.filter((g) => g.status === GoalStatus.AwaitingApproval);
  const paused = i.goals.filter((g) => g.status === GoalStatus.Paused && g.reason);
  const questions = i.notifications.filter((n) => n.kind === NotificationKind.Question && !n.answer);
  const runs = i.history.filter((r) => inWindow(r.startedAt, i.since, i.until));
  const spent = i.ledger.filter((e) => inWindow(e.ts, i.since, i.until)).reduce((a, e) => a + (e.costUsd ?? 0), 0);

  const items: BriefItem[] = [];
  for (const g of plans) items.push({ kind: 'plan', label: `${g.id} ${g.title}: plan ready, waiting for you`, href: `#/work/${g.id}`, tone: 'warning' });
  if (i.pendingApprovals) items.push({ kind: 'approval', label: `${i.pendingApprovals} ${i.pendingApprovals === 1 ? 'action waits' : 'actions wait'} for your approval`, href: '#/inbox', tone: 'warning' });
  for (const q of questions) items.push({ kind: 'question', label: q.title, href: '#/inbox', tone: 'warning' });
  for (const g of paused) items.push({ kind: 'paused', label: `${g.id} paused: ${String(g.reason).slice(0, 80)}`, href: `#/work/${g.id}`, tone: 'warning' });
  for (const g of failed) items.push({ kind: 'failed', label: `${g.id} ${g.title} failed`, href: `#/work/${g.id}`, tone: 'danger' });
  for (const g of prs) items.push({ kind: 'pr', label: `${g.id} ${g.title}: PR #${g.pr?.number ?? ''} opened`, href: `#/work/${g.id}`, tone: 'success' });
  for (const r of runs.filter((r) => r.outcome === 'failed')) items.push({ kind: 'automation', label: `${r.name}: ${r.reason ?? 'failed'}`, href: '#/automation', tone: 'danger' });
  for (const g of done.filter((g) => !g.pr)) items.push({ kind: 'done', label: `${g.id} ${g.title} finished`, href: `#/work/${g.id}`, tone: 'success' });

  return {
    since: i.since,
    until: i.until,
    goalsDone: done.length,
    goalsFailed: failed.length,
    prsOpened: prs.length,
    waiting: plans.length + paused.length + questions.length + i.pendingApprovals,
    spentUsd: Math.round(spent * 100) / 100,
    ...(i.dailyCapUsd ? { dailyCapUsd: i.dailyCapUsd } : {}),
    automationRuns: runs.length,
    items: items.slice(0, MAX_ITEMS),
  };
}

/** Something worth a "While you were away" card. */
export const briefHasNews = (b: Brief) => b.goalsDone + b.goalsFailed + b.prsOpened + b.waiting + b.automationRuns > 0 || b.spentUsd > 0;

/** One line for Slack/Teams. */
export function digestText(project: string, b: Brief, url: string): string {
  const parts = [
    `${b.goalsDone} ${b.goalsDone === 1 ? 'goal' : 'goals'} done`,
    b.prsOpened ? `${b.prsOpened} ${b.prsOpened === 1 ? 'PR' : 'PRs'} ready` : '',
    b.waiting ? `${b.waiting} ${b.waiting === 1 ? 'needs' : 'need'} you` : '',
    b.goalsFailed ? `${b.goalsFailed} failed` : '',
    `$${b.spentUsd.toFixed(2)} spent`,
  ].filter(Boolean);
  return `AgentRoom · ${project}: ${parts.join(', ')}. Open: ${url}`;
}
