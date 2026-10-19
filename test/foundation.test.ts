import { FsSettingsRepository } from '../src/core/repositories/settings.repository.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Project } from '../src/core/project.js';
import { ActorType, AgentEventType, AuditKind, GoalStatus, HostTool, TaskKind, TaskStatus, ToolName, WorkPhase } from '../src/shared/enums.js';
import type { AuditEntry, StampedEvent } from '../src/shared/types/index.js';
import { PermissionGate } from '../src/server/agents/permission-gate.js';
import { SessionStore } from '../src/server/agents/session-store.js';
import { Team } from '../src/server/agents/team.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import type { Provider, RunRequest, RunResult } from '../src/server/providers/provider.js';
import { Hub } from '../src/server/realtime/hub.js';
import { AuditService } from '../src/server/services/audit.service.js';
import { LedgerService } from '../src/server/services/ledger.service.js';
import { NotificationService } from '../src/server/services/notification.service.js';
import { SecretsStore } from '../src/server/services/secrets.store.js';
import { GoalRunner } from '../src/server/workflow/goal-runner.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-p0-'));

type Script = (req: RunRequest) => Promise<RunResult>;

/** Emits usage/tool/run_done like the Claude provider, and records what it was asked to run. */
class ScriptedProvider implements Provider {
  readonly id = 'fake';
  readonly requests: RunRequest[] = [];
  constructor(private readonly script?: Script) {}
  async run(req: RunRequest): Promise<RunResult> {
    this.requests.push(req);
    if (this.script) return this.script(req);
    req.emit({ type: AgentEventType.ToolCall, botId: req.bot.id, toolUseId: 't1', name: ToolName.Read, summary: 'a.ts', input: {} });
    req.emit({ type: AgentEventType.ToolCall, botId: req.bot.id, toolUseId: 't2', name: ToolName.Read, summary: 'b.ts', input: {} });
    req.emit({ type: AgentEventType.ToolCall, botId: req.bot.id, toolUseId: 't3', name: ToolName.Skill, summary: 'testing', input: { skill: 'agentroom:testing' } });
    const usage = { botId: req.bot.id, provider: 'claude', cacheWrite: 5, contextWindow: 200000 };
    req.emit({ type: AgentEventType.Usage, ...usage, model: 'side-model', input: 1, output: 2, cacheRead: 0, costUsd: 0.001, runs: 0 });
    req.emit({ type: AgentEventType.Usage, ...usage, model: req.model, input: 100, output: 50, cacheRead: 10, costUsd: 0.25, runs: 1 });
    req.emit({ type: AgentEventType.RunDone, botId: req.bot.id, ok: true, costUsd: 0.251, durationMs: 5, turns: 3, result: 'done' });
    return { ok: true, result: 'done' };
  }
  async listModels() {
    return [];
  }
}

function setup(provider: Provider = new ScriptedProvider()) {
  const root = tmp();
  const project = new Project(root);
  project.init();
  project.config.update({ permissionMode: 'auto', model: 'project-model' });
  const hub = new Hub(project.paths.runs);
  const ledger = new LedgerService(project.paths.ledgerFile);
  const notifications = new NotificationService(hub, project.paths.inboxFile);
  const team = new Team({
    project,
    hub,
    provider,
    previews: new PreviewService(hub),
    permissions: new PermissionGate(hub, () => project.config.get(), root),
    sessions: new SessionStore(project.paths.sessionsFile),
    notifications,
    boardChanged: () => {},
    ledger,
  });
  return { root, project, hub, ledger, team, notifications };
}

describe('settings', () => {
  it('defaults when missing, deep-merges per section, validates, and null clears a cap', () => {
    const { project } = setup();
    const s = project.settings.get();
    expect(s.budgets).toEqual({ perGoalUsd: null, perDayUsd: null, warnAt: 0.8 });
    expect(s.security.review).toBe('auto');
    expect(fs.existsSync(project.paths.settingsFile)).toBe(false);

    project.settings.update({ budgets: { perGoalUsd: 5 } });
    project.settings.update({ models: { planning: { model: 'opus' } } });
    const next = project.settings.update({ models: { testing: { model: 'haiku', effort: 'low' } } });
    expect(next.budgets).toMatchObject({ perGoalUsd: 5, warnAt: 0.8 });
    expect(next.models.planning.model).toBe('opus');
    expect(next.models.testing).toEqual({ model: 'haiku', effort: 'low' });
    expect(JSON.parse(fs.readFileSync(project.paths.settingsFile, 'utf8')).budgets.perGoalUsd).toBe(5);

    expect(project.settings.update({ budgets: { perGoalUsd: null } }).budgets.perGoalUsd).toBeNull();
    expect(() => project.settings.update({ budgets: { warnAt: 7 } })).toThrow(/budgets\.warnAt/);
    expect(() => project.settings.update({ security: { review: 'sometimes' as never } })).toThrow(/Invalid settings/);
  });
});

describe('secrets', () => {
  it('is write-only, 0600, validated, and clears with empty values', () => {
    const file = path.join(tmp(), 'runs', 'secrets.json');
    const store = new SecretsStore(file);
    expect(store.status()).toEqual({ slack: false, teams: false, email: false });
    expect(store.update({ slackWebhook: 'https://hooks.slack.com/x', smtp: { host: 'smtp.x', from: 'a@x', to: 'b@x' } })).toEqual({
      slack: true,
      teams: false,
      email: true,
    });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(store.read().smtp?.port).toBe(587);
    expect(() => store.update({ teamsWebhook: 'http://insecure' })).toThrow(/https/);
    expect(() => store.update({ smtp: { host: 'x' } })).toThrow(/smtp\.from/);
    expect(store.update({ slackWebhook: '', smtp: null })).toEqual({ slack: false, teams: false, email: false });
  });
});

describe('run ledger', () => {
  it('records one row per run with cost, tokens, model, skills and tool counts', async () => {
    const { team, ledger, project } = setup();
    await team.dispatch('qa', 'check it', 'human', { goalId: 'G-1', taskId: 'T-2', phase: WorkPhase.Testing });
    const [row] = ledger.list();
    expect(row).toMatchObject({
      botId: 'qa',
      goalId: 'G-1',
      taskId: 'T-2',
      phase: WorkPhase.Testing,
      model: 'project-model',
      ok: true,
      costUsd: 0.251,
      input: 101,
      output: 52,
      cacheRead: 10,
      cacheWrite: 10,
      turns: 3,
      skills: ['agentroom:testing'],
      tools: { Read: 2, Skill: 1 },
    });
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(fs.readFileSync(project.paths.ledgerFile, 'utf8').trim().split('\n')).toHaveLength(1);

    await team.dispatch('developer', 'more', 'human');
    expect(ledger.spentForGoal('G-1')).toBeCloseTo(0.251);
    expect(ledger.spentToday()).toBeCloseTo(0.502);
    expect(ledger.list({ botId: 'developer' })).toHaveLength(1);
    // Reloads from disk.
    expect(new LedgerService(project.paths.ledgerFile).list()).toHaveLength(2);
  });

  it('records failures with the first line of the error', async () => {
    const { team, ledger } = setup(new ScriptedProvider(async () => ({ ok: false, result: 'Run failed: boom\nstack…' })));
    await team.dispatch('qa', 'x');
    expect(ledger.list()[0]).toMatchObject({ ok: false, error: 'Run failed: boom' });
  });
});

describe('goal context and phase models', () => {
  it('stamps goalId on every event of a goal run, including permission and delegation events', async () => {
    const { team, hub } = setup();
    const seen: StampedEvent[] = [];
    hub.onEvent((e) => seen.push(e));
    await team.dispatch('qa', 'in goal', 'human', { goalId: 'G-7' });
    const inGoal = seen.filter((e) => 'botId' in e && e.botId === 'qa');
    expect(inGoal.length).toBeGreaterThan(3);
    expect(inGoal.every((e) => e.goalId === 'G-7')).toBe(true);

    seen.length = 0;
    await team.dispatch('qa', 'direct chat');
    expect(seen.some((e) => e.goalId)).toBe(false);
  });

  it('uses the phase model inside goal runs and the bot/project model in chat', async () => {
    const provider = new ScriptedProvider();
    const { team, project } = setup(provider);
    project.settings.update({ models: { build: { model: 'phase-build', effort: 'high' } } });
    project.bots.update('developer', { model: 'bot-model' });

    await team.dispatch('developer', 'build', 'human', { goalId: 'G-1', phase: WorkPhase.Build });
    await team.dispatch('developer', 'chat');
    await team.dispatch('qa', 'test', 'human', { goalId: 'G-1', phase: WorkPhase.Testing });
    expect(provider.requests.map((r) => [r.model, r.effort])).toEqual([
      ['phase-build', 'high'],
      ['bot-model', undefined],
      ['project-model', undefined],
    ]);
  });

  it('the goal runner passes phase and task to its runs', async () => {
    const provider = new ScriptedProvider(async (req) => {
      const call = (name: string, args: Record<string, unknown>) => req.hostTools.find((t) => t.name === name)!.handler(args);
      const goalId = /goal (G-\d+)/.exec(req.prompt)?.[1];
      if (req.bot.role === 'planner') await call(HostTool.TaskCreate, { title: 'Do it', kind: TaskKind.Dev, goalId, assignee: 'developer' });
      if (req.bot.role === 'developer') await call(HostTool.TaskUpdate, { id: /^# Build (T-\d+)/m.exec(req.prompt)![1], status: TaskStatus.Review });
      return { ok: true, result: 'ok' };
    });
    const s = setup(provider);
    s.project.settings.update({ models: { planning: { model: 'planner-model' } } });
    const runner = new GoalRunner({ project: s.project, team: s.team, hub: s.hub, notifications: s.notifications, boardChanged: () => {} });
    const goal = runner.start('Do a thing');
    const end = Date.now() + 3000;
    while (s.project.goals.get(goal.id)?.status !== GoalStatus.AwaitingApproval) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(provider.requests[0].model).toBe('planner-model');
    runner.approve(goal.id);
    while (!s.ledger.list().some((r) => r.phase === WorkPhase.Build)) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
    const build = s.ledger.list().find((r) => r.phase === WorkPhase.Build)!;
    expect(build).toMatchObject({ goalId: goal.id, botId: 'developer' });
    expect(build.taskId).toMatch(/^T-/);
    expect(s.ledger.list()[0]).toMatchObject({ phase: WorkPhase.Planning, goalId: goal.id });
    // Without QA tasks the goal goes on to report and finish by itself.
    while (s.project.goals.get(goal.id)?.status !== GoalStatus.Done) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(s.ledger.list().at(-1)).toMatchObject({ phase: WorkPhase.Reporting, botId: 'team-lead' });
  });
});

describe('audit log', () => {
  function gate(mode: 'auto' | 'ask-writes' = 'ask-writes') {
    const root = tmp();
    const project = new Project(root);
    project.init();
    project.config.update({ permissionMode: mode, alwaysAsk: ['git push'] });
    const hub = new Hub(project.paths.runs);
    const audit = new AuditService(project.paths.auditFile, 90);
    const g = new PermissionGate(hub, () => project.config.get(), root, { record: (e) => audit.record(e), humanName: () => 'Ada <ada@x>' });
    const requests: string[] = [];
    hub.onEvent((e) => e.type === AgentEventType.PermissionRequest && requests.push(e.requestId));
    hub.setRunContext('developer', { goalId: 'G-2', taskId: 'T-5' });
    return { g, audit, requests, signal: new AbortController().signal };
  }

  it('logs policy, session and human decisions with the right actor', async () => {
    const { g, audit, requests, signal } = gate();
    await g.ask('developer', ToolName.Read, { file_path: 'a.ts' }, signal); // not logged
    const edit = g.ask('developer', ToolName.Edit, { file_path: 'src/a.ts', old_string: 'x'.repeat(900), new_string: 'y' }, signal);
    g.resolve(requests[0], true, true);
    await edit;
    await g.ask('developer', ToolName.Edit, { file_path: 'src/b.ts' }, signal); // session rule now
    const push = g.ask('developer', ToolName.Bash, { command: 'npm test && git push origin agentroom/g-2' }, signal);
    g.resolve(requests[1], false);
    await push;
    const pending = g.ask('developer', ToolName.Bash, { command: 'rm -rf build' }, signal);
    g.cancel('developer');
    await pending;

    const entries = audit.query().entries.reverse();
    expect(entries.map((e) => [e.kind, e.actor.type, e.decision])).toEqual([
      [AuditKind.FileWrite, ActorType.Human, 'allowed'],
      [AuditKind.FileWrite, ActorType.Session, 'allowed'],
      [AuditKind.Push, ActorType.Human, 'denied'],
      [AuditKind.Command, ActorType.System, 'denied'],
    ]);
    expect(entries[0]).toMatchObject({ actor: { name: 'Ada <ada@x>' }, goalId: 'G-2', taskId: 'T-5', summary: 'Edit src/a.ts', detail: { alwaysAllow: 'Edit' } });
    expect(String((entries[0].detail!.input as Record<string, string>).old_string)).toMatch(/900 chars/);
    expect(entries[1].actor.name).toBe('Edit');
  });

  it('logs policy-allowed commands and detects PRs', async () => {
    const { g, audit, signal } = gate('auto');
    await g.ask('developer', ToolName.Bash, { command: 'gh pr create --fill' }, signal);
    await g.ask('developer', ToolName.Grep, { pattern: 'x' }, signal);
    const [e] = audit.query().entries;
    expect(audit.query().entries).toHaveLength(1);
    expect(e).toMatchObject({ kind: AuditKind.PullRequest, actor: { type: ActorType.Policy, name: 'auto mode' }, decision: 'allowed' });
  });

  it('filters, searches, paginates and prunes by retention', () => {
    const file = path.join(tmp(), 'audit.jsonl');
    const old: AuditEntry = { id: 'old', ts: '2020-01-01T00:00:00.000Z', kind: AuditKind.Command, actor: { type: ActorType.Bot, name: 'qa' }, summary: 'ancient' };
    fs.writeFileSync(file, JSON.stringify(old) + '\n');
    const audit = new AuditService(file, 30);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('ancient');

    for (let i = 0; i < 5; i++) {
      audit.record({
        ts: new Date(Date.now() + i).toISOString(),
        kind: i % 2 ? AuditKind.Push : AuditKind.Command,
        actor: { type: ActorType.Human, name: 'Ada' },
        botId: i < 3 ? 'qa' : 'developer',
        goalId: 'G-1',
        summary: `cmd ${i}`,
        detail: { secretWord: i === 4 ? 'needle' : 'hay' },
      });
    }
    expect(audit.query({ kind: AuditKind.Push }).entries.map((e) => e.summary)).toEqual(['cmd 3', 'cmd 1']);
    expect(audit.query({ botId: 'developer' }).entries).toHaveLength(2);
    expect(audit.query({ q: 'NEEDLE' }).entries.map((e) => e.summary)).toEqual(['cmd 4']);

    const page1 = audit.query({ limit: 2 });
    expect(page1).toMatchObject({ more: true });
    expect(page1.entries.map((e) => e.summary)).toEqual(['cmd 4', 'cmd 3']);
    const page2 = audit.query({ limit: 2, before: page1.entries[1].ts });
    expect(page2.entries.map((e) => e.summary)).toEqual(['cmd 2', 'cmd 1']);
    const page3 = audit.query({ limit: 2, before: page2.entries[1].ts });
    expect(page3).toMatchObject({ more: false });
    expect(page3.entries.map((e) => e.summary)).toEqual(['cmd 0']);
    expect(new AuditService(file, 30).query().entries).toHaveLength(5);
  });
});

import fsx from 'node:fs';

describe('settings phase models', () => {
  it('replaces a phase choice so it can be cleared', () => {
    const repo = new FsSettingsRepository(path.join(fsx.mkdtempSync(path.join(os.tmpdir(), 'ar-set-')), 'settings.json'));
    repo.update({ models: { build: { model: 'sonnet', effort: 'high' } } });
    expect(repo.get().models.build).toEqual({ model: 'sonnet', effort: 'high' });
    repo.update({ models: { build: { model: 'haiku' } } });
    expect(repo.get().models.build).toEqual({ model: 'haiku' });
    repo.update({ models: { build: {} } });
    expect(repo.get().models.build).toEqual({});
    expect(repo.get().budgets.warnAt).toBe(0.8);
  });
});
