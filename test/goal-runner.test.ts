import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Project } from '../src/core/project.js';
import { GoalStatus, HostTool, NotificationKind, TaskKind, TaskStatus } from '../src/shared/enums.js';
import type { Bot } from '../src/shared/types/index.js';
import { PermissionGate } from '../src/server/agents/permission-gate.js';
import { SessionStore } from '../src/server/agents/session-store.js';
import { Team } from '../src/server/agents/team.js';
import { humanTools } from '../src/server/agents/tools/human.tools.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import type { Provider, RunRequest, RunResult } from '../src/server/providers/provider.js';
import { Hub } from '../src/server/realtime/hub.js';
import { NotificationService } from '../src/server/services/notification.service.js';
import { GoalRunner } from '../src/server/workflow/goal-runner.js';

type Script = (req: RunRequest, call: (tool: string, args: Record<string, unknown>) => Promise<string>) => Promise<string>;

/** A provider that runs a per-role script against the real host tools. */
class FakeProvider implements Provider {
  readonly id = 'fake';
  readonly calls: string[] = [];
  constructor(private readonly scripts: Record<string, Script>) {}
  async run(req: RunRequest): Promise<RunResult> {
    this.calls.push(req.bot.role);
    const call = (name: string, args: Record<string, unknown>) => {
      const tool = req.hostTools.find((t) => t.name === name);
      if (!tool) throw new Error(`${req.bot.id} has no tool ${name}`);
      return tool.handler(args);
    };
    const result = await (this.scripts[req.bot.role] ?? (async () => 'ok'))(req, call);
    return { ok: true, result };
  }
  async listModels() {
    return [];
  }
}

function setup(scripts: Record<string, Script>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-goal-'));
  const project = new Project(root);
  project.init();
  // Make every tool call allowed without asking.
  project.config.update({ permissionMode: 'auto' });
  const hub = new Hub(project.paths.runs);
  const provider = new FakeProvider(scripts);
  const notifications = new NotificationService(hub, project.paths.inboxFile);
  const boardChanged = () => {};
  const team = new Team({
    project,
    hub,
    provider,
    previews: new PreviewService(hub),
    permissions: new PermissionGate(hub, () => project.config.get(), root),
    sessions: new SessionStore(project.paths.sessionsFile),
    notifications,
    boardChanged,
  });
  const runner = new GoalRunner({ project, team, hub, notifications, boardChanged });
  return { project, hub, provider, notifications, runner };
}

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const goalIdOf = (prompt: string) => /goal (G-\d+)/.exec(prompt)![1];
const taskIdOf = (prompt: string) => /^# (?:Build|QA) (T-\d+)/m.exec(prompt)![1];

describe('GoalRunner', () => {
  it('plans, waits for approval, builds, loops on a QA bug, then reports', async () => {
    let qaRuns = 0;
    const { project, provider, notifications, runner } = setup({
      planner: async (req, call) => {
        const goalId = goalIdOf(req.prompt);
        await call(HostTool.PlanOverview, { goalId, markdown: 'Add divide()' });
        const dev = JSON.parse(await call(HostTool.TaskCreate, { title: 'Add divide', kind: TaskKind.Dev, goalId, assignee: 'developer', acceptance: ['throws on 0'] }));
        await call(HostTool.TaskCreate, { title: 'Verify divide', kind: TaskKind.QA, goalId, assignee: 'qa', dependsOn: [dev.id] });
        return 'Planned 2 tasks.';
      },
      developer: async (req, call) => {
        const id = taskIdOf(req.prompt);
        await call(HostTool.TaskUpdate, { id, appendLog: 'implemented', acceptanceDone: [0], status: TaskStatus.Review });
        return 'Done.';
      },
      qa: async (req, call) => {
        qaRuns++;
        const id = taskIdOf(req.prompt);
        if (qaRuns === 1) {
          await call(HostTool.TaskCreate, { title: 'divide(0,0) returns NaN', kind: TaskKind.Bug, goalId: goalIdOf(req.prompt), assignee: 'developer' });
          await call(HostTool.TaskUpdate, { id, appendLog: 'found a bug' });
          return 'Failed.';
        }
        await call(HostTool.TaskUpdate, { id, status: TaskStatus.Done });
        return 'Passed.';
      },
      lead: async () => '## Outcome\nAll good.',
    });

    const goal = runner.start('Add a divide(a, b) function\nthat throws on zero');
    expect(goal.title).toBe('Add a divide(a, b) function');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    expect(project.goals.get(goal.id)!.plan).toBe('Add divide()');
    expect(notifications.list().map((n) => n.kind)).toContain(NotificationKind.PlanReady);
    expect(() => runner.resume(goal.id)).toThrow();

    runner.approve(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Done);

    const final = project.goals.get(goal.id)!;
    expect(final.summary).toContain('All good');
    expect(final.round).toBe(1);
    expect(provider.calls).toEqual(['planner', 'developer', 'qa', 'developer', 'qa', 'lead']);
    const tasks = project.tasks.list({ goalId: goal.id });
    expect(tasks.map((t) => [t.kind, t.status])).toEqual([
      [TaskKind.Dev, TaskStatus.Done],
      [TaskKind.QA, TaskStatus.Done],
      [TaskKind.Bug, TaskStatus.Done],
    ]);
    expect(tasks[0].log.map((l) => l.text)).toContain('implemented');
    expect(notifications.list().at(-1)!.kind).toBe(NotificationKind.GoalDone);
  });

  it('pauses with a Blocked notification when the developer is blocked, and resumes', async () => {
    let blocked = true;
    const { project, notifications, runner } = setup({
      planner: async (req, call) => {
        await call(HostTool.TaskCreate, { title: 'A', kind: TaskKind.Dev, goalId: goalIdOf(req.prompt), assignee: 'developer' });
        return 'ok';
      },
      developer: async (req, call) => {
        const id = taskIdOf(req.prompt);
        if (blocked) await call(HostTool.TaskUpdate, { id, blockedReason: 'Need an API key' });
        else await call(HostTool.TaskUpdate, { id, status: TaskStatus.Review });
        return 'ok';
      },
      lead: async () => 'report',
    });
    const goal = runner.start('Do A');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    runner.approve(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Paused);
    expect(project.goals.get(goal.id)!.reason).toContain('Need an API key');
    expect(notifications.list().some((n) => n.kind === NotificationKind.Blocked)).toBe(true);

    blocked = false;
    await waitFor(() => !runner.isRunning(goal.id));
    runner.resume(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Done);
  });

  it('pauses when the plan has no dev tasks, and supports replan', async () => {
    let attempt = 0;
    const { project, runner } = setup({
      planner: async (req, call) => {
        if (++attempt === 2) await call(HostTool.TaskCreate, { title: 'A', kind: TaskKind.Dev, goalId: goalIdOf(req.prompt) });
        return 'ok';
      },
    });
    const goal = runner.start('Vague');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Paused);
    await waitFor(() => !runner.isRunning(goal.id));
    runner.replan(goal.id, 'Be specific');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
  });

  it('cancels a running goal and moves active goals to Paused on restart', async () => {
    const { project, runner } = setup({
      planner: () => new Promise((r) => setTimeout(() => r('late'), 200)),
    });
    const g1 = runner.start('Slow');
    await waitFor(() => runner.isRunning(g1.id));
    runner.cancel(g1.id);
    expect(project.goals.get(g1.id)!.status).toBe(GoalStatus.Cancelled);

    const g2 = project.goals.create({ title: 'B', brief: 'b' });
    project.goals.update(g2.id, { status: GoalStatus.Building });
    runner.recoverOnStartup();
    expect(project.goals.get(g2.id)!.status).toBe(GoalStatus.Paused);
    expect(project.goals.get(g2.id)!.reason).toMatch(/restarted/);
  });
});

describe('ask_human', () => {
  it('blocks until the human answers', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-ask-'));
    const project = new Project(root);
    project.init();
    const hub = new Hub(project.paths.runs);
    const notifications = new NotificationService(hub, project.paths.inboxFile);
    const bot = project.bots.get('developer') as Bot;
    const ask = humanTools(bot, { hub, notifications, tasks: project.tasks }, new AbortController().signal).find((t) => t.name === HostTool.AskHuman)!;

    let answer: string | undefined;
    const pending = ask.handler({ question: 'Which port?', options: ['3000', '5173'] }).then((a) => (answer = a));
    await waitFor(() => notifications.list().length === 1);
    const q = notifications.list()[0];
    expect(q).toMatchObject({ kind: NotificationKind.Question, body: 'Which port?', options: ['3000', '5173'], read: false });
    expect(answer).toBeUndefined();

    notifications.answer(q.id, '5173');
    await pending;
    expect(answer).toBe('The human answered: 5173');
    expect(notifications.list()[0]).toMatchObject({ answer: '5173', read: true });
    // Persisted.
    expect(JSON.parse(fs.readFileSync(project.paths.inboxFile, 'utf8'))[0].answer).toBe('5173');
  });
});
