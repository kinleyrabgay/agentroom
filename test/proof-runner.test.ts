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
import { GoalRunner, QUALITY_GATE } from '../src/server/workflow/goal-runner.js';
import type { ProofService } from '../src/server/proof/proof.service.js';
import type { ProofReport, ProofScenario } from '../src/shared/types/index.js';

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

function setup(scripts: Record<string, Script>, proof?: ProofService) {
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
  const runner = new GoalRunner({ project, team, hub, notifications, boardChanged, ...(proof ? { proof } : {}) });
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

/** A ProofService stand-in: hands back scripted reports. */
function fakeProof(reports: Array<Partial<ProofReport>>) {
  let stored: ProofScenario[] = [];
  const runs: ProofScenario[][] = [];
  let last: ProofReport | null = null;
  const svc = {
    hasApp: () => true,
    scenarios: () => stored,
    setScenarios: (_id: string, list: ProofScenario[]) => (stored = list),
    report: () => last,
    isRunning: () => false,
    stop: () => {},
    markdown: () => null,
    publish: async () => last,
    run: async (t: { goal: { id: string; round: number } }, scenarios: ProofScenario[]) => {
      runs.push(scenarios);
      const next = reports.shift() ?? {};
      last = { goalId: t.goal.id, round: t.goal.round, status: 'passed', startedAt: '', finishedAt: 'now', scenarios: [], checks: [], ...next } as ProofReport;
      return last;
    },
  };
  return { svc: svc as unknown as ProofService, runs };
}

const SCENARIO = '```json\n{"scenarios":[{"name":"Divide in the UI","path":"/","steps":[{"action":"expect","value":"Result"}]}]}\n```';

describe('GoalRunner Verify phase', () => {
  it('records proof, turns a broken scenario into a bug round, then holds failing checks at the quality gate', async () => {
    let qaVerify = 0;
    const { svc, runs } = fakeProof([
      { status: 'failed', scenarios: [{ name: 'Divide in the UI', ok: false, error: 'Step 1 (Shows "Result") failed: timeout', frames: [], before: [] }] },
      { status: 'passed', scenarios: [{ name: 'Divide in the UI', ok: true, frames: [], before: [] }], checks: [{ id: 'a11y', label: 'Accessibility', status: 'fail', summary: '1 new serious issue' }] },
    ]);
    const { project, provider, runner } = setup(
      {
        planner: async (req, call) => {
          const goalId = goalIdOf(req.prompt);
          const dev = JSON.parse(await call(HostTool.TaskCreate, { title: 'Add divide', kind: TaskKind.Dev, goalId, assignee: 'developer' }));
          await call(HostTool.TaskCreate, { title: 'Verify', kind: TaskKind.QA, goalId, assignee: 'qa', dependsOn: [dev.id] });
          return 'ok';
        },
        developer: async (req, call) => {
          await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Review });
          return 'ok';
        },
        qa: async (req, call) => {
          if (req.prompt.startsWith('# Proof of work')) {
            qaVerify++;
            return SCENARIO;
          }
          await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Done });
          return 'Passed.';
        },
        lead: async () => '## Outcome\nDone.',
      },
      svc,
    );
    const goal = runner.start('Add divide');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    runner.approve(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Paused);

    const held = project.goals.get(goal.id)!;
    expect(held.reason).toMatch(new RegExp(`^${QUALITY_GATE}`));
    expect(held.round).toBe(1);
    expect(held.proof).toMatchObject({ round: 1, status: 'passed', failing: ['Accessibility'] });
    expect(qaVerify).toBe(1);
    expect(runs).toHaveLength(2);
    expect(runs[1][0].name).toBe('Divide in the UI');
    const bug = project.tasks.list({ goalId: goal.id }).find((t) => t.kind === TaskKind.Bug)!;
    expect(bug.title).toBe('Proof failed: Divide in the UI');
    expect(bug.description).toContain('timeout');
    expect(provider.calls).toEqual(['planner', 'developer', 'qa', 'qa', 'developer', 'qa']);

    runner.resume(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Done);
    expect(project.goals.get(goal.id)!.proofOverride?.round).toBe(1);
    expect(runs).toHaveLength(2);
  });

  it('skips Verify when QA says there is no UI', async () => {
    const { svc, runs } = fakeProof([]);
    const { project, runner } = setup(
      {
        planner: async (req, call) => {
          const goalId = goalIdOf(req.prompt);
          await call(HostTool.TaskCreate, { title: 'Lib', kind: TaskKind.Dev, goalId, assignee: 'developer' });
          return 'ok';
        },
        developer: async (req, call) => {
          await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Review });
          return 'ok';
        },
        qa: async () => '```json\n{ "scenarios": [] }\n```',
        lead: async () => 'Done.',
      },
      svc,
    );
    const goal = runner.start('Add a helper');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    runner.approve(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Done);
    expect(runs).toHaveLength(0);
    expect(project.goals.get(goal.id)!.proof?.status).toBe('skipped');
  });
});
