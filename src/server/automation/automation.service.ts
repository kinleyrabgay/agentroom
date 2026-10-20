import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditKind, GoalStatus, NotificationKind, StateType } from '../../shared/enums.js';
import { ScheduleSchema, TriggerSchema } from '../../shared/schemas.js';
import type {
  AutomationScope,
  AutomationAction,
  AutomationRun,
  AutomationSnapshot,
  Brief,
  Goal,
  LedgerEntry,
  NextRun,
  Notification,
  Schedule,
  ScheduleView,
  Settings,
  Trigger,
  TriggerView,
} from '../../shared/types/index.js';
import { readJson, writeJson } from '../../core/fs/json.js';
import { runsHere, type AutomationRepository } from '../../core/repositories/automation.repository.js';
import { buildBrief, briefHasNews, digestText } from './brief.js';
import { decide, localDay, movedCards, newSentryIssues, triggerBlocked, type ScheduleState } from './plan.js';
import { cronError } from './time-parse.js';
import { teamsTextMessage } from '../intake/teams/cards.js';

const TICK_MS = 30_000;
const POLL_MS = 5 * 60_000;
const FIRST_POLL_MS = 20_000;
const HISTORY_LIMIT = 200;
/** Away at least this long before the "While you were away" card shows. */
export const AWAY_MS = 2 * 60 * 60 * 1000;

interface TriggerState {
  runsByDay: Record<string, number>;
  lastRunAt?: string;
  lastOutcome?: AutomationRun['outcome'];
}

interface State {
  schedules: Record<string, ScheduleState>;
  triggers: Record<string, TriggerState>;
  sentrySeen?: string[];
  githubSnapshot?: Record<string, string>;
  /** Linear/Jira issue states at the last poll, per tracker. */
  trackerSnapshots?: Record<string, Record<string, string>>;
  failedGoalsSeen?: string[];
  /** Goals that build without waiting for plan approval. */
  autoBuild: string[];
  lastSeenAt?: string;
  away?: { from: string; to: string; dismissed?: boolean };
  digestSentOn?: string;
  historySeenAt?: string;
}

export interface SentryIssueLite {
  id: string;
  shortId: string;
  title: string;
  level: string;
  permalink?: string;
  project: { slug: string };
}

export interface GithubCardLite {
  id: string;
  title: string;
  url?: string;
  /** Column name. */
  status: string;
}

type HandoffSource = 'github' | 'sentry' | 'linear' | 'jira';

export interface AutomationDeps {
  repo: AutomationRepository;
  stateFile: string;
  historyFile: string;
  pushState: (snapshot: AutomationSnapshot) => void;
  /** True while an AgentRoom tab is visible. */
  isActive: () => boolean;
  onPresence?: (fn: () => void) => void;
  startGoal: (a: Extract<AutomationAction, { type: 'goal' }>) => Goal;
  approvePlan: (goalId: string) => void;
  setGoalBudget?: (goalId: string, usd: number) => void;
  goals: () => Goal[];
  sendToBot: (botId: string, text: string) => void;
  handoff: (source: HandoffSource, input: { ids: string[]; botId?: string; note?: string }) => Promise<{ botId: string; goal?: { id: string } }>;
  notify: (n: { kind: NotificationKind; title: string; body: string; goalId?: string }) => void;
  notifications: () => Notification[];
  pendingApprovals: () => number;
  ledgerSince: (since: string) => LedgerEntry[];
  spentToday: () => number;
  settings: () => Settings;
  /** Newest Sentry issues, or null when Sentry isn't connected. */
  sentryIssues?: () => Promise<SentryIssueLite[] | null>;
  /** Board cards with their column names, or null when no board is connected. */
  githubCards?: () => Promise<GithubCardLite[] | null>;
  /** Open issues of a connected tracker with their state names, or null when it isn't connected. */
  trackerIssues?: (tracker: 'linear' | 'jira') => Promise<GithubCardLite[] | null>;
  webhook: (channel: 'slack' | 'teams') => string | undefined;
  post?: (url: string, body: unknown) => Promise<void>;
  projectName: string;
  url: () => string;
  audit: (summary: string, detail?: Record<string, unknown>) => void;
  human: () => string;
  now?: () => Date;
}

type ScheduleInput = Omit<Schedule, 'id' | 'createdAt' | 'createdBy' | 'enabled' | 'runner' | 'owner'> & Partial<Pick<Schedule, 'enabled' | 'runner'>> & OwnerPatch;
/** `owner: 'me'` takes over a team item (it then runs on this machine). */
type OwnerPatch = { owner?: 'me' };
type TriggerInput = Omit<Trigger, 'id' | 'createdAt' | 'createdBy' | 'enabled' | 'runner' | 'limits' | 'owner'> & OwnerPatch &
  Partial<Pick<Trigger, 'enabled' | 'runner' | 'limits'>>;

/**
 * Runs the team without the human: schedules (once or repeating), triggers (Sentry, GitHub, failed goals),
 * the "While you were away" brief and the daily digest. Only this machine runs them for now; the runner
 * field keeps the config ready for a cloud runner.
 */
export class AutomationService {
  private state: State;
  private history: AutomationRun[];
  private timers: NodeJS.Timeout[] = [];
  private wasActive = false;
  private polling = false;

  constructor(private readonly deps: AutomationDeps) {
    this.state = { schedules: {}, triggers: {}, autoBuild: [], ...readJson<Partial<State>>(deps.stateFile, {}) } as State;
    this.history = readHistory(deps.historyFile);
    // Coming back up: the time since the last visible moment counts as away.
    if (this.state.lastSeenAt && !this.state.away) this.state.away = { from: this.state.lastSeenAt, to: '' };
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  start() {
    this.wasActive = this.deps.isActive();
    this.deps.onPresence?.(() => this.presence());
    const tick = setInterval(() => void this.tick(), TICK_MS);
    const poll = setInterval(() => void this.poll(), POLL_MS);
    const first = setTimeout(() => void this.poll(), FIRST_POLL_MS);
    for (const t of [tick, poll, first]) t.unref();
    this.timers.push(tick, poll, first);
    void this.tick();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ---------- snapshot ----------

  snapshot(): AutomationSnapshot {
    const schedules: ScheduleView[] = this.deps.repo.schedules().map((s) => {
      const st = this.state.schedules[s.id] ?? {};
      const d = decide(s, st, this.now());
      return {
        ...s,
        runsHere: this.here(s),
        nextRunAt: s.enabled && this.here(s) ? (st.nextRunAt ?? d.nextRunAt) : null,
        lastRunAt: st.lastRunAt ?? null,
        ...(st.lastOutcome ? { lastOutcome: st.lastOutcome } : {}),
        ...(s.action.type === 'message' || s.action.type === 'handoff' ? (s.action.botId ? { botId: s.action.botId } : {}) : {}),
      };
    });
    const today = localDay(this.now());
    const triggers: TriggerView[] = this.deps.repo.triggers().map((t) => {
      const st = this.state.triggers[t.id];
      return { ...t, runsHere: this.here(t), runsToday: st?.runsByDay[today] ?? 0, lastRunAt: st?.lastRunAt ?? null, ...(st?.lastOutcome ? { lastOutcome: st.lastOutcome } : {}) };
    });
    const seen = this.state.historySeenAt ?? '';
    return {
      schedules,
      triggers,
      history: this.history.slice(-50).reverse(),
      next: nextOf(schedules),
      failedSinceSeen: this.history.filter((r) => r.outcome === 'failed' && r.startedAt > seen).length,
    };
  }

  push() {
    this.deps.pushState(this.snapshot());
  }

  next(): NextRun | null {
    return this.snapshot().next;
  }

  historyList(limit = 100): AutomationRun[] {
    const costs = new Map<string, number>();
    const rows = this.history.slice(-Math.min(limit, HISTORY_LIMIT)).reverse();
    for (const r of rows) {
      if (r.goalId && !costs.has(r.goalId)) costs.set(r.goalId, this.deps.ledgerSince(r.startedAt).filter((e) => e.goalId === r.goalId).reduce((a, e) => a + e.costUsd, 0));
    }
    return rows.map((r) => (r.goalId ? { ...r, costUsd: Math.round((costs.get(r.goalId) ?? 0) * 100) / 100 } : r));
  }

  markSeen() {
    this.state.historySeenAt = this.now().toISOString();
    this.save();
    this.push();
  }

  // ---------- schedules ----------

  createSchedule(input: ScheduleInput): Schedule {
    const schedule = this.validateSchedule({
      ...this.scoped(input),
      id: `S-${randomBytes(3).toString('hex')}`,
      enabled: input.enabled ?? true,
      runner: input.runner ?? 'local',
      createdAt: this.now().toISOString(),
      createdBy: this.deps.human(),
    });
    this.deps.repo.saveSchedules([...this.deps.repo.schedules(), schedule]);
    this.deps.audit(`Schedule created: ${schedule.name}`, { id: schedule.id, when: schedule.when });
    this.push();
    return schedule;
  }

  updateSchedule(id: string, patch: Partial<ScheduleInput>): Schedule {
    const list = this.deps.repo.schedules();
    const cur = list.find((s) => s.id === id);
    if (!cur) throw new Error(`No schedule ${id}.`);
    const next = this.validateSchedule({ ...cur, ...this.scoped(patch, cur), id: cur.id, createdAt: cur.createdAt });
    // Changing when it runs restarts its clock.
    if (patch.when || (patch.enabled && !cur.enabled)) delete this.state.schedules[id];
    this.deps.repo.saveSchedules(list.map((s) => (s.id === id ? next : s)));
    this.save();
    this.deps.audit(`Schedule changed: ${next.name}`, { id, keys: Object.keys(patch) });
    this.push();
    return next;
  }

  deleteSchedule(id: string) {
    const list = this.deps.repo.schedules();
    const cur = list.find((s) => s.id === id);
    if (!cur) throw new Error(`No schedule ${id}.`);
    this.deps.repo.saveSchedules(list.filter((s) => s.id !== id));
    delete this.state.schedules[id];
    this.save();
    this.deps.audit(`Schedule deleted: ${cur.name}`, { id });
    this.push();
  }

  async runNow(id: string): Promise<AutomationRun> {
    const s = this.deps.repo.schedules().find((x) => x.id === id);
    if (!s) throw new Error(`No schedule ${id}.`);
    this.deps.audit(`Schedule run now: ${s.name}`, { id });
    return this.fireSchedule(s, false);
  }

  /** This machine runs the item (personal, or team and owned by the current git user). */
  private here(item: Schedule | Trigger) {
    return runsHere(item, this.deps.repo.owner());
  }

  /**
   * Resolve `scope` and `owner` for a create/patch: personal by default; a team item gets the
   * current git user as owner when it becomes team, and `owner: 'me'` takes one over.
   */
  private scoped<T extends { scope?: AutomationScope; owner?: unknown }>(input: T, cur?: Schedule | Trigger) {
    const { owner, ...rest } = input;
    const scope: AutomationScope = rest.scope ?? cur?.scope ?? 'personal';
    const me = this.deps.repo.owner();
    if (scope === 'team' && !me.email) throw new Error('Set your git user.email first: team automation runs on its owner\'s machine.');
    const nextOwner = scope === 'team' ? (owner === 'me' || !cur?.owner || cur.scope !== 'team' ? me : cur.owner) : undefined;
    return { ...rest, scope, ...(nextOwner ? { owner: nextOwner } : { owner: undefined }) };
  }

  private validateSchedule(raw: unknown): Schedule {
    const parsed = ScheduleSchema.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.') || 'schedule'}: ${i.message}`).join('; '));
    // `scope` isn't stored in the file (it's where the item lives), so the schema drops it: keep it.
    const s = { ...parsed.data, scope: (raw as { scope?: AutomationScope }).scope ?? 'personal' } as Schedule;
    if (s.runner === 'cloud') throw new Error("The cloud runner isn't available yet. Use This Mac.");
    if (s.when.type === 'cron') {
      const err = cronError(s.when.cron);
      if (err) throw new Error(`Repeat rule: ${err}`);
    }
    return s;
  }

  // ---------- triggers ----------

  createTrigger(input: TriggerInput): Trigger {
    const t = this.validateTrigger({
      ...this.scoped(input),
      id: `T-${randomBytes(3).toString('hex')}`,
      enabled: input.enabled ?? true,
      runner: input.runner ?? 'local',
      limits: input.limits ?? {},
      createdAt: this.now().toISOString(),
      createdBy: this.deps.human(),
    });
    this.deps.repo.saveTriggers([...this.deps.repo.triggers(), t]);
    this.deps.audit(`Trigger created: ${t.name}`, { id: t.id, when: t.when, then: t.then });
    this.push();
    return t;
  }

  updateTrigger(id: string, patch: Partial<TriggerInput>): Trigger {
    const list = this.deps.repo.triggers();
    const cur = list.find((t) => t.id === id);
    if (!cur) throw new Error(`No trigger ${id}.`);
    const next = this.validateTrigger({ ...cur, ...this.scoped(patch, cur), id: cur.id, createdAt: cur.createdAt });
    this.deps.repo.saveTriggers(list.map((t) => (t.id === id ? next : t)));
    this.deps.audit(`Trigger changed: ${next.name}`, { id, keys: Object.keys(patch) });
    this.push();
    return next;
  }

  deleteTrigger(id: string) {
    const list = this.deps.repo.triggers();
    const cur = list.find((t) => t.id === id);
    if (!cur) throw new Error(`No trigger ${id}.`);
    this.deps.repo.saveTriggers(list.filter((t) => t.id !== id));
    delete this.state.triggers[id];
    this.save();
    this.deps.audit(`Trigger deleted: ${cur.name}`, { id });
    this.push();
  }

  /** Dry run: what the trigger would do with the most recent matching event. No side effects. */
  async testTrigger(id: string): Promise<{ wouldFire: boolean; reason?: string; event?: string; action: string }> {
    const t = this.deps.repo.triggers().find((x) => x.id === id);
    if (!t) throw new Error(`No trigger ${id}.`);
    const blocked = triggerBlocked({ ...t, enabled: true }, this.runsToday(t.id), this.now());
    const action = describeThen(t);
    if (t.when.source === 'sentry') {
      const issues = (await this.deps.sentryIssues?.()) ?? null;
      if (!issues) return { wouldFire: false, reason: 'Sentry is not connected', action };
      const match = issues.find((i) => matchesSentry(t, i));
      if (!match) return { wouldFire: false, reason: 'No recent issue matches this trigger', action };
      return { wouldFire: !blocked, ...(blocked ? { reason: blocked } : {}), event: `${match.shortId}: ${match.title}`, action };
    }
    if (t.when.source === 'github') {
      const cards = (await this.deps.githubCards?.()) ?? null;
      if (!cards) return { wouldFire: false, reason: 'No GitHub board is connected', action };
      const col = t.when.toColumn;
      const match = cards.find((c) => sameColumn(c.status, col));
      if (!match) return { wouldFire: false, reason: `No card is in "${col}" right now`, action };
      return { wouldFire: !blocked, ...(blocked ? { reason: blocked } : {}), event: `${match.title} (in ${match.status})`, action };
    }
    if (t.when.source === 'linear' || t.when.source === 'jira') {
      const name = t.when.source === 'linear' ? 'Linear' : 'Jira';
      const issues = (await this.deps.trackerIssues?.(t.when.source)) ?? null;
      if (!issues) return { wouldFire: false, reason: `${name} is not connected`, action };
      const state = t.when.toState;
      const match = issues.find((c) => sameColumn(c.status, state));
      if (!match) return { wouldFire: false, reason: `No ${name} issue is in "${state}" right now`, action };
      return { wouldFire: !blocked, ...(blocked ? { reason: blocked } : {}), event: `${match.title} (in ${match.status})`, action };
    }
    const failed = this.deps.goals().filter((g) => g.status === GoalStatus.Failed).at(-1);
    if (!failed) return { wouldFire: false, reason: 'No goal has failed yet', action };
    return { wouldFire: !blocked, ...(blocked ? { reason: blocked } : {}), event: `${failed.id} ${failed.title} failed`, action };
  }

  private validateTrigger(raw: unknown): Trigger {
    const parsed = TriggerSchema.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.') || 'trigger'}: ${i.message}`).join('; '));
    const t = { ...parsed.data, scope: (raw as { scope?: AutomationScope }).scope ?? 'personal' } as Trigger;
    if (t.runner === 'cloud') throw new Error("The cloud runner isn't available yet. Use This Mac.");
    if (t.then.type === 'message' && !t.then.botId) throw new Error('Pick the bot to message.');
    if (t.then.type === 'handoff' && t.when.source === 'goal') throw new Error('A failed goal can be sent to a bot as a message, not handed off.');
    return t;
  }

  private runsToday(id: string) {
    return this.state.triggers[id]?.runsByDay[localDay(this.now())] ?? 0;
  }

  // ---------- brief and digest ----------

  /** "While you were away", if the human was away long enough and something happened. */
  briefForReturn(): Brief | null {
    const away = this.state.away;
    if (!away || away.dismissed || !away.to) return null;
    if (Date.parse(away.to) - Date.parse(away.from) < AWAY_MS) return null;
    const b = this.brief(away.from);
    return briefHasNews(b) ? b : null;
  }

  brief(since: string, until = this.now().toISOString()): Brief {
    return buildBrief({
      since,
      until,
      goals: this.deps.goals(),
      ledger: this.deps.ledgerSince(since),
      notifications: this.deps.notifications(),
      pendingApprovals: this.deps.pendingApprovals(),
      history: this.history,
      ...(this.deps.settings().budgets.perDayUsd ? { dailyCapUsd: this.deps.settings().budgets.perDayUsd! } : {}),
    });
  }

  dismissBrief() {
    if (this.state.away) this.state.away.dismissed = true;
    this.save();
  }

  /** Presence changed (a tab became visible or hidden). */
  presence() {
    const active = this.deps.isActive();
    const now = this.now().toISOString();
    if (active && !this.wasActive) {
      // Back: close the away window that started when the last tab went away.
      const from = this.state.away?.from ?? this.state.lastSeenAt;
      if (from && !this.state.away?.to) this.state.away = { from, to: now };
    }
    if (!active && this.wasActive) this.state.away = { from: now, to: '' };
    if (active) this.state.lastSeenAt = now;
    this.wasActive = active;
    this.save();
  }

  // ---------- the loop ----------

  async tick(): Promise<void> {
    const now = this.now();
    if (this.deps.isActive()) {
      this.state.lastSeenAt = now.toISOString();
      if (!this.wasActive) this.presence();
    } else if (this.wasActive) this.presence();

    for (const s of this.deps.repo.schedules()) {
      // Team schedules run only on their owner's machine.
      if (!this.here(s)) continue;
      const st = this.state.schedules[s.id] ?? {};
      const d = decide(s, st, now);
      if (d.action === 'wait') {
        if (d.nextRunAt !== (st.nextRunAt ?? null) && d.nextRunAt) this.state.schedules[s.id] = { ...st, nextRunAt: d.nextRunAt };
        continue;
      }
      if (d.action === 'missed') {
        this.record({ kind: 'schedule', refId: s.id, name: s.name, outcome: 'skipped', reason: `Missed ${new Date(d.dueAt).toLocaleString()} (AgentRoom wasn't running)` });
        this.state.schedules[s.id] = { ...st, nextRunAt: d.nextRunAt ?? undefined, lastOutcome: 'skipped', ...(d.disable ? { lastRunAt: now.toISOString() } : {}) };
        if (d.disable) this.disable(s.id);
        continue;
      }
      this.state.schedules[s.id] = { ...st, nextRunAt: d.nextRunAt ?? undefined, lastRunAt: now.toISOString() };
      this.save();
      await this.fireSchedule(s, d.disable);
    }

    this.autoBuildPending();
    this.goalFailures();
    await this.digest(now);
    this.save();
    this.push();
  }

  private disable(id: string) {
    this.deps.repo.saveSchedules(this.deps.repo.schedules().map((s) => (s.id === id ? { ...s, enabled: false } : s)));
  }

  private async fireSchedule(s: Schedule, disableAfter: boolean): Promise<AutomationRun> {
    const blocked = s.runner === 'cloud' ? 'Cloud runner is not available yet' : this.dailyCapReached();
    let run: AutomationRun;
    if (blocked) {
      run = this.record({ kind: 'schedule', refId: s.id, name: s.name, outcome: 'skipped', reason: blocked });
    } else {
      run = await this.execute(s.action, { kind: 'schedule', refId: s.id, name: s.name });
    }
    this.state.schedules[s.id] = { ...(this.state.schedules[s.id] ?? {}), lastRunAt: run.startedAt, lastOutcome: run.outcome };
    if (disableAfter) this.disable(s.id);
    this.save();
    this.push();
    return run;
  }

  private dailyCapReached(): string | null {
    const cap = this.deps.settings().budgets.perDayUsd;
    return cap && this.deps.spentToday() >= cap ? 'Daily budget reached' : null;
  }

  /** Do the action and record it. Never throws: failures become history rows and an Inbox item. */
  private async execute(action: AutomationAction, ctx: { kind: AutomationRun['kind']; refId: string; name: string }, opts: { budgetUsd?: number; autoBuild?: boolean } = {}): Promise<AutomationRun> {
    try {
      if (action.type === 'goal') {
        const goal = this.deps.startGoal({ ...action, ...(opts.budgetUsd && !action.budgetUsd ? { budgetUsd: opts.budgetUsd } : {}) });
        if (action.autoBuild || opts.autoBuild) this.state.autoBuild = [...new Set([...this.state.autoBuild, goal.id])];
        return this.record({ ...ctx, outcome: 'started', goalId: goal.id });
      }
      if (action.type === 'message') {
        this.deps.sendToBot(action.botId, action.text);
        return this.record({ ...ctx, outcome: 'started', reason: `Sent to ${action.botId}` });
      }
      const res = await this.deps.handoff(action.source, { ids: action.ids, ...(action.botId ? { botId: action.botId } : {}), ...(action.note ? { note: action.note } : {}) });
      if (res.goal && opts.autoBuild) this.state.autoBuild = [...new Set([...this.state.autoBuild, res.goal.id])];
      // Hand-offs start through their usual path; the trigger's budget is applied afterwards.
      if (res.goal && opts.budgetUsd) this.deps.setGoalBudget?.(res.goal.id, opts.budgetUsd);
      return this.record({ ...ctx, outcome: 'started', ...(res.goal ? { goalId: res.goal.id } : { reason: `Sent to ${res.botId}` }) });
    } catch (err) {
      const reason = (err as Error).message;
      const run = this.record({ ...ctx, outcome: 'failed', reason });
      this.deps.notify({ kind: NotificationKind.GoalFailed, title: `Automation failed: ${ctx.name}`, body: reason });
      return run;
    }
  }

  /** Plans from "build without waiting" automation get approved as soon as they're ready. */
  private autoBuildPending() {
    if (!this.state.autoBuild.length) return;
    const goals = new Map(this.deps.goals().map((g) => [g.id, g]));
    const keep: string[] = [];
    for (const id of this.state.autoBuild) {
      const g = goals.get(id);
      if (!g) continue;
      if (g.status === GoalStatus.AwaitingApproval) {
        try {
          this.deps.approvePlan(id);
          this.deps.audit(`Plan of ${id} approved automatically (automation)`, { goalId: id });
        } catch (err) {
          this.deps.notify({ kind: NotificationKind.Blocked, title: `Couldn't auto-approve ${id}`, body: (err as Error).message, goalId: id });
        }
        continue;
      }
      if (g.status === GoalStatus.Planning) keep.push(id);
    }
    this.state.autoBuild = keep;
  }

  /** Goal-failed triggers (from the goals themselves, no polling of anything external). */
  private goalFailures() {
    const triggers = this.deps.repo.triggers().filter((t) => t.when.source === 'goal' && this.here(t));
    const failed = this.deps.goals().filter((g) => g.status === GoalStatus.Failed);
    if (!this.state.failedGoalsSeen) {
      this.state.failedGoalsSeen = failed.map((g) => g.id);
      return;
    }
    const seen = new Set(this.state.failedGoalsSeen);
    const fresh = failed.filter((g) => !seen.has(g.id));
    if (!fresh.length) return;
    this.state.failedGoalsSeen = [...seen, ...fresh.map((g) => g.id)].slice(-500);
    for (const g of fresh) for (const t of triggers) void this.fireTrigger(t, { title: `${g.id} ${g.title}`, url: `#/work/${g.id}`, reason: g.reason ?? '' });
  }

  /** Check Sentry and the GitHub board for trigger events. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const triggers = this.deps.repo.triggers().filter((t) => t.enabled && this.here(t));
      if (triggers.some((t) => t.when.source === 'sentry') && this.deps.sentryIssues) {
        const issues = await this.deps.sentryIssues().catch(() => null);
        if (issues) {
          const { fresh, seen } = newSentryIssues(issues, this.state.sentrySeen);
          this.state.sentrySeen = seen;
          for (const issue of fresh) {
            for (const t of triggers.filter((t) => matchesSentry(t, issue))) {
              await this.fireTrigger(t, { title: `${issue.shortId}: ${issue.title}`, url: issue.permalink ?? '', ids: [issue.id], source: 'sentry' });
            }
          }
        }
      }
      if (triggers.some((t) => t.when.source === 'github') && this.deps.githubCards) {
        const cards = await this.deps.githubCards().catch(() => null);
        if (cards) {
          const { moved, snapshot } = movedCards(cards, this.state.githubSnapshot);
          this.state.githubSnapshot = snapshot;
          for (const card of moved) {
            for (const t of triggers.filter((t) => t.when.source === 'github' && sameColumn(card.status, t.when.toColumn))) {
              await this.fireTrigger(t, { title: card.title, url: card.url ?? '', ids: [card.id], source: 'github' });
            }
          }
        }
      }
      for (const tracker of ['linear', 'jira'] as const) {
        const mine = triggers.filter((t) => t.when.source === tracker);
        if (!mine.length || !this.deps.trackerIssues) continue;
        const issues = await this.deps.trackerIssues(tracker).catch(() => null);
        if (!issues) continue;
        const snaps = (this.state.trackerSnapshots ??= {});
        const { moved, snapshot } = movedCards(issues, snaps[tracker]);
        snaps[tracker] = snapshot;
        for (const issue of moved) {
          for (const t of mine.filter((t) => t.when.source === tracker && sameColumn(issue.status, t.when.toState))) {
            await this.fireTrigger(t, { title: issue.title, url: issue.url ?? '', ids: [issue.id], source: tracker });
          }
        }
      }
      this.save();
      this.push();
    } finally {
      this.polling = false;
    }
  }

  private async fireTrigger(t: Trigger, ev: { title: string; url: string; ids?: string[]; source?: HandoffSource; reason?: string }) {
    const blocked = triggerBlocked(t, this.runsToday(t.id), this.now()) ?? this.dailyCapReached();
    const st = this.state.triggers[t.id] ?? { runsByDay: {} };
    if (blocked) {
      const run = this.record({ kind: 'trigger', refId: t.id, name: t.name, outcome: 'skipped', reason: `${blocked} · ${ev.title}` });
      this.state.triggers[t.id] = { ...st, lastRunAt: run.startedAt, lastOutcome: 'skipped' };
      return;
    }
    const day = localDay(this.now());
    st.runsByDay = { [day]: (st.runsByDay[day] ?? 0) + 1 };
    const ctx = { kind: 'trigger' as const, refId: t.id, name: `${t.name} · ${ev.title}` };
    const opts = { ...(t.limits.budgetUsd ? { budgetUsd: t.limits.budgetUsd } : {}), autoBuild: !t.then.planOnly };
    const text = fill(t.then.text ?? defaultText(t), ev);
    let run: AutomationRun;
    if (t.then.type === 'notify') {
      this.deps.notify({ kind: NotificationKind.Info, title: t.name, body: `${ev.title}${ev.url ? `\n${ev.url}` : ''}` });
      if (t.then.channel === 'slack' || t.then.channel === 'teams') await this.sendWebhook(t.then.channel, `${t.name}: ${ev.title} ${ev.url}`.trim());
      run = this.record({ ...ctx, outcome: 'started', reason: 'Notified' });
    } else if (t.then.type === 'handoff' && ev.source && ev.ids) {
      run = await this.execute({ type: 'handoff', source: ev.source, ids: ev.ids, ...(t.then.botId ? { botId: t.then.botId } : {}), ...(t.then.text ? { note: text } : {}) }, ctx, opts);
    } else if (t.then.type === 'message' && t.then.botId) {
      run = await this.execute({ type: 'message', botId: t.then.botId, text }, ctx, opts);
    } else {
      run = await this.execute({ type: 'goal', brief: text, title: ev.title.slice(0, 80) }, ctx, opts);
    }
    this.state.triggers[t.id] = { ...st, lastRunAt: run.startedAt, lastOutcome: run.outcome };
  }

  private async digest(now: Date) {
    const d = this.deps.settings().digest;
    if (!d?.enabled) return;
    const day = localDay(now);
    const [h, m] = d.time.split(':').map(Number);
    if (this.state.digestSentOn === day || now.getHours() * 60 + now.getMinutes() < (h ?? 8) * 60 + (m ?? 30)) return;
    this.state.digestSentOn = day;
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const text = digestText(this.deps.projectName, this.brief(since), this.deps.url());
    const sent: string[] = [];
    for (const ch of d.channels) if (await this.sendWebhook(ch, text)) sent.push(ch);
    this.record({ kind: 'digest', refId: 'digest', name: 'Daily digest', outcome: sent.length ? 'started' : 'skipped', reason: sent.length ? `Sent to ${sent.join(', ')}` : 'No webhook set' });
  }

  private async sendWebhook(channel: 'slack' | 'teams', text: string): Promise<boolean> {
    const url = this.deps.webhook(channel);
    if (!url) return false;
    try {
      // Teams Workflows webhooks only take Adaptive Card messages; older connectors accept them too.
      await (this.deps.post ?? postJson)(url, channel === 'teams' ? teamsTextMessage(text) : { text });
      return true;
    } catch (err) {
      this.deps.notify({ kind: NotificationKind.Info, title: `Couldn't post to ${channel === 'slack' ? 'Slack' : 'Teams'}`, body: (err as Error).message });
      return false;
    }
  }

  // ---------- persistence ----------

  private record(r: Omit<AutomationRun, 'id' | 'startedAt'>): AutomationRun {
    const run: AutomationRun = { id: randomUUID(), startedAt: this.now().toISOString(), ...r };
    this.history.push(run);
    if (this.history.length > HISTORY_LIMIT * 2) this.history = this.history.slice(-HISTORY_LIMIT);
    try {
      fs.mkdirSync(path.dirname(this.deps.historyFile), { recursive: true });
      fs.appendFileSync(this.deps.historyFile, JSON.stringify(run) + '\n');
    } catch {
      // history is best-effort
    }
    return run;
  }

  private save() {
    writeJson(this.deps.stateFile, this.state);
  }
}

function readHistory(file: string): AutomationRun[] {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AutomationRun)
      .slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function nextOf(list: ScheduleView[]): NextRun | null {
  const upcoming = list.filter((s) => s.enabled && s.nextRunAt).sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];
  return upcoming ? { id: upcoming.id, name: upcoming.name, at: upcoming.nextRunAt! } : null;
}

const LEVEL_RANK: Record<string, number> = { fatal: 3, error: 2, warning: 1 };

function matchesSentry(t: Trigger, i: SentryIssueLite): boolean {
  if (t.when.source !== 'sentry') return false;
  if (t.when.project && t.when.project !== i.project.slug) return false;
  // "level error" also catches fatal ones.
  if (t.when.level && (LEVEL_RANK[i.level] ?? 0) < (LEVEL_RANK[t.when.level] ?? 0)) return false;
  return true;
}

const sameColumn = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function defaultText(t: Trigger): string {
  if (t.when.source === 'goal') return 'Goal {title} failed. Find out why and fix it if you can. {url}';
  return 'Look into {title}. {url}';
}

const fill = (text: string, ev: { title: string; url: string; reason?: string }) =>
  text.replaceAll('{title}', ev.title).replaceAll('{url}', ev.url).replaceAll('{reason}', ev.reason ?? '').trim();

function describeThen(t: Trigger): string {
  const who = t.then.botId ?? 'the Team Lead';
  switch (t.then.type) {
    case 'handoff':
      return `Hand it to ${who}${t.then.planOnly ? ' and stop after the plan' : ' and build it'}`;
    case 'goal':
      return `Start a goal${t.then.planOnly ? ' and stop after the plan' : ' and build it'}`;
    case 'message':
      return `Message ${who}`;
    default:
      return `Notify you${t.then.channel && t.then.channel !== 'inbox' ? ` on ${t.then.channel}` : ''}`;
  }
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Webhook answered ${res.status}`);
}

