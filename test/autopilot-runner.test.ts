import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Project } from '../src/core/project.js';
import { GoalStatus, HostTool, TaskKind, TaskStatus } from '../src/shared/enums.js';
import type { SentryIssueDetail } from '../src/shared/types/index.js';
import { PermissionGate } from '../src/server/agents/permission-gate.js';
import { SessionStore } from '../src/server/agents/session-store.js';
import { Team } from '../src/server/agents/team.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import type { Provider, RunRequest, RunResult } from '../src/server/providers/provider.js';
import { Hub } from '../src/server/realtime/hub.js';
import { NotificationService } from '../src/server/services/notification.service.js';
import { GoalRunner } from '../src/server/workflow/goal-runner.js';
import { AutopilotService, NOT_REPRODUCED } from '../src/server/autopilot/autopilot.service.js';

type Script = (req: RunRequest, call: (tool: string, args: Record<string, unknown>) => Promise<string>) => Promise<string>;

class FakeProvider implements Provider {
  readonly id = 'fake';
  readonly tools: Record<string, string[]> = {};
  constructor(private readonly scripts: Record<string, Script>) {}
  async run(req: RunRequest): Promise<RunResult> {
    this.tools[req.bot.role] = req.hostTools.map((t) => t.name);
    const call = (name: string, args: Record<string, unknown>) => {
      const tool = req.hostTools.find((t) => t.name === name);
      if (!tool) throw new Error(`${req.bot.id} has no tool ${name}`);
      return tool.handler(args);
    };
    return { ok: true, result: await (this.scripts[req.bot.role] ?? (async () => 'ok'))(req, call) };
  }
  async listModels() {
    return [];
  }
}

const detail = (id: string) =>
  ({
    issue: { id, shortId: `WEB-${id}`, title: 'TypeError: cart is undefined', level: 'error', project: { slug: 'web' }, count: 4, userCount: 2, firstSeen: '2026-10-20T00:00:00Z', lastSeen: '2026-10-20T01:00:00Z' },
    event: { exceptions: [], breadcrumbs: [], contexts: [], message: 'cart is undefined' },
  }) as unknown as SentryIssueDetail;

function setup(scripts: Record<string, Script>, verify?: ConstructorParameters<typeof AutopilotService>[0]['verify']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-autopilot-'));
  const project = new Project(root);
  project.init();
  project.config.update({ permissionMode: 'auto' });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', 'cart.test.ts'), '');
  const hub = new Hub(project.paths.runs);
  const provider = new FakeProvider(scripts);
  const notifications = new NotificationService(hub, project.paths.inboxFile);
  const boardChanged = () => {};
  // The autopilot and the runner need each other; the runner is created below.
  let runner: GoalRunner;
  const autopilot = new AutopilotService({
    root,
    goals: () => ({
      list: () => runner.list(),
      get: (id) => project.goals.get(id),
      start: (brief, title, sources, t) => runner.start(brief, title, sources, undefined, [], t ? { template: { id: t.id, name: t.name }, guidance: t.guidance } : {}),
      update: (id, patch) => project.goals.update(id, patch),
      changedFiles: async () => [],
      cwdOf: (g) => runner.cwdOf(g),
      openPr: async (id) => project.goals.get(id)!,
      isRunning: (id) => runner.isRunning(id),
    }),
    detail: async (id) => detail(id),
    template: () => project.goalTemplates.get('reproduce-first'),
    bots: () => project.bots.list(),
    settings: () => project.settings.get(),
    notify: (n) => void notifications.create(n),
    audit: () => {},
    scratchDir: fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-autopilot-scratch-')),
    ...(verify ? { verify } : {}),
  });
  const team = new Team({
    project,
    hub,
    provider,
    previews: new PreviewService(hub),
    permissions: new PermissionGate(hub, () => project.config.get(), root),
    sessions: new SessionStore(project.paths.sessionsFile),
    notifications,
    boardChanged,
    autopilot,
  });
  runner = new GoalRunner({ project, team, hub, notifications, boardChanged, autopilot });
  return { project, provider, runner, autopilot, notifications };
}

const waitFor = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const goalIdOf = (prompt: string) => /goal (G-\d+)/.exec(prompt)![1];
const taskIdOf = (prompt: string) => /^# (?:Build|QA) (T-\d+)/m.exec(prompt)![1];

const planner: Script = async (req, call) => {
  const goalId = goalIdOf(req.prompt);
  const dev = JSON.parse(await call(HostTool.TaskCreate, { title: 'Reproduce, test, fix', kind: TaskKind.Dev, goalId, assignee: 'developer' }));
  await call(HostTool.TaskCreate, { title: 'Re-run tests', kind: TaskKind.QA, goalId, assignee: 'qa', dependsOn: [dev.id] });
  return 'ok';
};
const qa: Script = async (req, call) => {
  await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Done });
  return 'Passed.';
};

describe('GoalRunner with autopilot', () => {
  it("stops for the human when the bug can't be reproduced, then continues after resume", async () => {
    let attempts = 0;
    const { project, runner, autopilot, provider, notifications } = setup({
      planner,
      developer: async (req, call) => {
        attempts++;
        if (attempts === 1) return call(HostTool.AutopilotReport, { reproduced: false, how: 'Tried an empty cart and a guest checkout.' });
        await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Review });
        return 'fixed';
      },
      qa,
      lead: async () => 'Done.',
    });
    const goal = await autopilot.startFromSentry('42', { by: 'Tester' });
    expect(goal.template?.id).toBe('reproduce-first');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    runner.approve(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Paused);
    const held = project.goals.get(goal.id)!;
    expect(held.reason).toContain(NOT_REPRODUCED);
    expect(held.autopilot?.status).toBe('needs_human');
    expect(provider.tools.developer).toContain(HostTool.AutopilotReport);
    expect(notifications.list().some((n) => /couldn't reproduce/.test(n.title))).toBe(true);

    runner.resume(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Done);
  });

  it('verifies the failing test before the report and puts the evidence in the PR draft', async () => {
    const { project, runner, autopilot } = setup(
      {
        planner,
        developer: async (req, call) => {
          await call(HostTool.AutopilotReport, { reproduced: true, how: 'Empty cart crashes checkout.', testFile: 'test/cart.test.ts', testCommand: 'npx vitest run test/cart.test.ts' });
          await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Review });
          return 'fixed';
        },
        qa,
        lead: async () => 'Done.',
      },
      async () => ({ failsOnBase: true, passesOnHead: true, detail: 'ok' }),
    );
    const goal = await autopilot.startFromSentry('43', { by: 'Tester' });
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    // Not a git repo here, so no base commit: verification falls back to what the bot reported.
    project.goals.update(goal.id, { baseRef: 'abc123' });
    runner.approve(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Done);
    const done = project.goals.get(goal.id)!;
    expect(done.autopilot?.verification).toMatchObject({ failsOnBase: true, passesOnHead: true });
    expect(done.autopilot?.confidence?.score).toBeGreaterThan(60);
    await waitFor(() => project.goals.get(goal.id)!.autopilot?.status === 'ready');
    const draft = await runner.prDraft(goal.id);
    expect(draft.body).toContain('Fixes WEB-43');
    expect(draft.body).toContain('### Autopilot');
    expect(draft.body).toMatch(/Confidence:\*\* \d+\/100/);
  });
});
