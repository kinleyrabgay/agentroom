import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWhen } from '../src/server/automation/time-parse.js';
import { decide, inQuietHours, movedCards, newSentryIssues, triggerBlocked, MISSED_AFTER_MS } from '../src/server/automation/plan.js';
import { buildBrief, briefHasNews, digestText } from '../src/server/automation/brief.js';
import { AutomationService, AWAY_MS, type AutomationDeps } from '../src/server/automation/automation.service.js';
import { AutomationRepository } from '../src/core/repositories/automation.repository.js';
import { buildPlist, agentLabel, liveSession, writeSession, clearSession, readSession } from '../src/server/runner/background.js';
import { SettingsSchema } from '../src/shared/schemas.js';
import { GoalStatus } from '../src/shared/enums.js';
import type { Goal, Schedule, Trigger } from '../src/shared/types/index.js';

// Tuesday 20 Oct 2026, 14:30 local time.
const NOW = new Date(2026, 9, 20, 14, 30);
const local = (iso: string | null) => (iso ? new Date(iso) : null);

describe('parseWhen', () => {
  it('finds one-off times and the exact phrase', () => {
    const r = parseWhen('Start implementing the feature tomorrow at 9:00 AM', NOW);
    expect(local(r.at)).toEqual(new Date(2026, 9, 21, 9, 0));
    expect(r.phrase).toBe('tomorrow at 9:00 AM');
    expect(r.rest).toBe('Start implementing the feature');
    expect(r.recurring).toBeNull();
  });

  it('understands tonight, in N hours and day-part words', () => {
    expect(local(parseWhen('Run e2e tonight', NOW).at)).toEqual(new Date(2026, 9, 20, 22, 0));
    expect(local(parseWhen('Check again in 2 hours', NOW).at)).toEqual(new Date(2026, 9, 20, 16, 30));
    const monday = parseWhen('Review on Monday morning', NOW);
    expect(local(monday.at)).toEqual(new Date(2026, 9, 26, 9, 0));
    expect(monday.rest).toBe('Review');
  });

  it('turns repeating phrases into cron', () => {
    expect(parseWhen('Triage Sentry every weekday at 8:30', NOW).recurring).toEqual({ cron: '30 8 * * 1-5', label: 'Weekdays at 8:30 AM' });
    expect(parseWhen('Nightly e2e every day at 10pm', NOW).recurring?.cron).toBe('0 22 * * *');
    const mon = parseWhen('Audit deps every Monday 9am', NOW);
    expect(mon.recurring?.cron).toBe('0 9 * * 1');
    expect(local(mon.at)).toEqual(new Date(2026, 9, 26, 9, 0));
  });

  it('leaves text without a time alone', () => {
    expect(parseWhen('Fix the login bug', NOW)).toEqual({ at: null, phrase: null, recurring: null, rest: 'Fix the login bug' });
  });
});

const schedule = (when: Schedule['when'], extra: Partial<Schedule> = {}): Schedule => ({
  id: 'S-1',
  name: 'Test',
  enabled: true,
  when,
  action: { type: 'goal', brief: 'Do it' },
  runner: 'local',
  createdAt: new Date(2026, 9, 19, 12, 0).toISOString(),
  ...extra,
});

describe('decide', () => {
  it('fires a one-off once, after its time', () => {
    const s = schedule({ type: 'once', at: new Date(2026, 9, 20, 14, 0).toISOString() });
    expect(decide(s, {}, new Date(2026, 9, 20, 13, 0)).action).toBe('wait');
    expect(decide(s, {}, NOW)).toMatchObject({ action: 'fire', disable: true });
    expect(decide(s, { lastRunAt: NOW.toISOString() }, NOW).action).toBe('wait');
  });

  it('marks one-offs missed when AgentRoom was off for too long', () => {
    const s = schedule({ type: 'once', at: new Date(NOW.getTime() - MISSED_AFTER_MS - 60_000).toISOString() });
    expect(decide(s, {}, NOW).action).toBe('missed');
  });

  it('repeats on cron and moves to the next run', () => {
    const s = schedule({ type: 'cron', cron: '0 9 * * *', label: 'Every day at 9:00 AM' });
    const first = decide(s, {}, new Date(2026, 9, 20, 8, 0));
    expect(first.action).toBe('wait');
    const due = decide(s, { nextRunAt: new Date(2026, 9, 20, 9, 0).toISOString() }, new Date(2026, 9, 20, 9, 0, 30));
    expect(due.action).toBe('fire');
    expect(local(due.nextRunAt)).toEqual(new Date(2026, 9, 21, 9, 0));
  });

  it('never fires a disabled schedule', () => {
    expect(decide(schedule({ type: 'once', at: NOW.toISOString() }, { enabled: false }), {}, NOW).action).toBe('wait');
  });
});

describe('trigger helpers', () => {
  const trigger: Trigger = {
    id: 'T-1',
    name: 'Fatal issues',
    enabled: true,
    when: { source: 'sentry', event: 'new_issue', level: 'fatal' },
    then: { type: 'handoff', planOnly: true },
    limits: { maxRunsPerDay: 2, quietHours: { from: '22:00', to: '07:00' } },
    runner: 'local',
    createdAt: NOW.toISOString(),
  };

  it('quiet hours cross midnight', () => {
    expect(inQuietHours({ from: '22:00', to: '07:00' }, new Date(2026, 9, 20, 23, 0))).toBe(true);
    expect(inQuietHours({ from: '22:00', to: '07:00' }, new Date(2026, 9, 20, 6, 59))).toBe(true);
    expect(inQuietHours({ from: '22:00', to: '07:00' }, NOW)).toBe(false);
  });

  it('applies the daily limit and quiet hours', () => {
    expect(triggerBlocked(trigger, 0, NOW)).toBeNull();
    expect(triggerBlocked(trigger, 2, NOW)).toMatch(/2 runs today/);
    expect(triggerBlocked(trigger, 0, new Date(2026, 9, 20, 23, 0))).toMatch(/Quiet hours/);
  });

  it('remembers Sentry issues on first look and fires only for new ones', () => {
    const first = newSentryIssues([{ id: '1' }, { id: '2' }], undefined);
    expect(first.fresh).toEqual([]);
    const second = newSentryIssues([{ id: '3' }, { id: '1' }], first.seen);
    expect(second.fresh.map((i) => i.id)).toEqual(['3']);
  });

  it('spots GitHub cards that changed column', () => {
    const first = movedCards([{ id: 'a', status: 'Backlog' }], undefined);
    expect(first.moved).toEqual([]);
    const next = movedCards([{ id: 'a', status: 'Ready' }, { id: 'b', status: 'Ready' }], first.snapshot);
    expect(next.moved.map((c) => c.id)).toEqual(['a']);
  });
});

const goal = (id: string, status: Goal['status'], extra: Partial<Goal> = {}): Goal =>
  ({ id, title: `Goal ${id}`, brief: '', status, plan: '', summary: '', sources: [], securityReview: 'auto', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...extra }) as Goal;

describe('brief', () => {
  it('summarises the window and lists what needs you first', () => {
    const since = new Date(NOW.getTime() - 3 * 3600_000).toISOString();
    const b = buildBrief({
      since,
      until: NOW.toISOString(),
      goals: [goal('G-1', GoalStatus.Done, { pr: { url: 'https://x/pr/9', number: 9 } }), goal('G-2', GoalStatus.AwaitingApproval), goal('G-3', GoalStatus.Failed)],
      ledger: [{ ts: NOW.toISOString(), costUsd: 1.234 } as never, { ts: '2020-01-01T00:00:00Z', costUsd: 9 } as never],
      notifications: [],
      pendingApprovals: 1,
      history: [],
    });
    expect(b).toMatchObject({ goalsDone: 1, goalsFailed: 1, prsOpened: 1, waiting: 2, spentUsd: 1.23 });
    expect(b.items[0]).toMatchObject({ kind: 'plan', href: '#/work/G-2' });
    expect(briefHasNews(b)).toBe(true);
    expect(digestText('demo', b, 'http://localhost:4317')).toBe('AgentRoom · demo: 1 goal done, 1 PR ready, 2 need you, 1 failed, $1.23 spent. Open: http://localhost:4317');
  });
});

function harness(over: Partial<AutomationDeps> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-auto-'));
  let now = NOW;
  const goals: Goal[] = [];
  const started: string[] = [];
  const approved: string[] = [];
  const deps: AutomationDeps = {
    repo: new AutomationRepository({ schedules: path.join(dir, 'schedules.json'), triggers: path.join(dir, 'triggers.json') }),
    stateFile: path.join(dir, 'state.json'),
    historyFile: path.join(dir, 'history.jsonl'),
    pushState: () => {},
    isActive: () => false,
    startGoal: (a) => {
      const g = goal(`G-${goals.length + 1}`, GoalStatus.Planning, { title: a.title ?? a.brief });
      goals.push(g);
      started.push(a.brief);
      return g;
    },
    approvePlan: (id) => {
      approved.push(id);
      const g = goals.find((x) => x.id === id)!;
      g.status = GoalStatus.Building;
    },
    goals: () => goals,
    sendToBot: () => {},
    handoff: async () => ({ botId: 'lead' }),
    notify: () => {},
    notifications: () => [],
    pendingApprovals: () => 0,
    ledgerSince: () => [],
    spentToday: () => 0,
    settings: () => SettingsSchema.parse({}),
    webhook: () => undefined,
    projectName: 'demo',
    url: () => 'http://localhost',
    audit: () => {},
    human: () => 'Tester',
    now: () => now,
    ...over,
  };
  return { dir, deps, goals, started, approved, setNow: (d: Date) => (now = d), svc: new AutomationService(deps) };
}

describe('AutomationService', () => {
  it('fires a one-off schedule once, then disables it; restarts do not double-fire', async () => {
    const h = harness();
    const s = h.svc.createSchedule({ name: 'Morning build', when: { type: 'once', at: new Date(2026, 9, 20, 15, 0).toISOString() }, action: { type: 'goal', brief: 'Build it' } });
    await h.svc.tick();
    expect(h.started).toEqual([]);
    h.setNow(new Date(2026, 9, 20, 15, 0, 20));
    await h.svc.tick();
    await h.svc.tick();
    expect(h.started).toEqual(['Build it']);
    expect(h.deps.repo.schedules()[0]).toMatchObject({ id: s.id, enabled: false });
    // A new process reading the same state doesn't fire it again.
    const again = new AutomationService(h.deps);
    await again.tick();
    expect(h.started).toHaveLength(1);
    expect(h.svc.historyList()[0]).toMatchObject({ outcome: 'started', goalId: 'G-1' });
  });

  it('skips when the daily budget is used up', async () => {
    const h = harness({ spentToday: () => 12, settings: () => SettingsSchema.parse({ budgets: { perDayUsd: 10 } }) });
    const s = h.svc.createSchedule({ name: 'Nightly', when: { type: 'cron', cron: '0 9 * * *', label: 'Every day at 9:00 AM' }, action: { type: 'goal', brief: 'x' } });
    const run = await h.svc.runNow(s.id);
    expect(run).toMatchObject({ outcome: 'skipped', reason: 'Daily budget reached' });
    expect(h.started).toEqual([]);
  });

  it('approves the plan for "build without waiting" goals', async () => {
    const h = harness();
    const s = h.svc.createSchedule({ name: 'Auto', when: { type: 'once', at: NOW.toISOString() }, action: { type: 'goal', brief: 'Auto build', autoBuild: true } });
    await h.svc.runNow(s.id);
    h.goals[0]!.status = GoalStatus.AwaitingApproval;
    await h.svc.tick();
    expect(h.approved).toEqual(['G-1']);
  });

  it('rejects the cloud runner and bad cron', () => {
    const h = harness();
    expect(() => h.svc.createSchedule({ name: 'x', runner: 'cloud', when: { type: 'once', at: NOW.toISOString() }, action: { type: 'goal', brief: 'x' } })).toThrow(/cloud/i);
    expect(() => h.svc.createSchedule({ name: 'x', when: { type: 'cron', cron: 'not a cron', label: '?' }, action: { type: 'goal', brief: 'x' } })).toThrow();
  });

  it('fires Sentry triggers for new issues only, within limits', async () => {
    let issues = [{ id: '1', shortId: 'WEB-1', title: 'Old', level: 'fatal', project: { slug: 'web' } }];
    const handed: string[][] = [];
    const h = harness({ sentryIssues: async () => issues, handoff: async (_s, input) => (handed.push(input.ids), { botId: 'fixer' }) });
    h.svc.createTrigger({ name: 'Fatal', when: { source: 'sentry', event: 'new_issue', level: 'fatal' }, then: { type: 'handoff', botId: 'fixer', planOnly: true }, limits: { maxRunsPerDay: 1 } });
    await h.svc.poll();
    expect(handed).toEqual([]);
    issues = [
      { id: '2', shortId: 'WEB-2', title: 'New fatal', level: 'fatal', project: { slug: 'web' } },
      { id: '3', shortId: 'WEB-3', title: 'Just a warning', level: 'warning', project: { slug: 'web' } },
      ...issues,
    ];
    await h.svc.poll();
    expect(handed).toEqual([['2']]);
    issues = [{ id: '4', shortId: 'WEB-4', title: 'Another fatal', level: 'fatal', project: { slug: 'web' } }, ...issues];
    await h.svc.poll();
    expect(handed).toHaveLength(1);
    expect(h.svc.historyList()[0]).toMatchObject({ outcome: 'skipped' });
  });

  it('shows the brief after being away long enough', async () => {
    let active = true;
    const h = harness({ isActive: () => active });
    h.goals.push(goal('G-9', GoalStatus.Done));
    h.svc.presence();
    active = false;
    h.svc.presence();
    h.setNow(new Date(NOW.getTime() + AWAY_MS + 60_000));
    h.goals[0]!.updatedAt = new Date(NOW.getTime() + 60_000).toISOString();
    active = true;
    h.svc.presence();
    expect(h.svc.briefForReturn()).toMatchObject({ goalsDone: 1 });
    h.svc.dismissBrief();
    expect(h.svc.briefForReturn()).toBeNull();
  });
});

describe('background mode', () => {
  it('builds a LaunchAgent that runs agentroom start in the repo', () => {
    const label = agentLabel('/Users/me/code/My App');
    expect(label).toMatch(/^dev\.agentroom\.my-app-[0-9a-f]{8}$/);
    const plist = buildPlist({ label, root: '/Users/me/code/My App', port: 4317, provider: 'claude', logFile: '/tmp/d.log', cli: '/x/cli.js', node: '/usr/bin/node', pathEnv: '/usr/bin' });
    expect(plist).toContain('<string>start</string>');
    expect(plist).toContain('<string>--no-open</string>');
    expect(plist).toContain('<key>WorkingDirectory</key><string>/Users/me/code/My App</string>');
    expect(plist).toContain('<key>AGENTROOM_DAEMON</key><string>1</string>');
    expect(plist).toContain('<key>KeepAlive</key><true/>');
  });

  it('reuses a live session and ignores a dead one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-session-'));
    const file = path.join(dir, 'session.json');
    writeSession(file, { port: 4317, token: 't', url: 'http://localhost:4317/?t=t', pid: 123, startedAt: NOW.toISOString() });
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
    expect(await liveSession(file, async () => true)).toMatchObject({ port: 4317 });
    expect(await liveSession(file, async () => false)).toBeNull();
    clearSession(file, 999);
    expect(readSession(file)).not.toBeNull();
    clearSession(file, 123);
    expect(readSession(file)).toBeNull();
  });
});
