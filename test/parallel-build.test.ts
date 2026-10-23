import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Project } from '../src/core/project.js';
import { AgentEventType, GoalStatus, HostTool, TaskKind, TaskStatus } from '../src/shared/enums.js';
import { PermissionGate } from '../src/server/agents/permission-gate.js';
import { SessionStore } from '../src/server/agents/session-store.js';
import { Team } from '../src/server/agents/team.js';
import * as gg from '../src/server/git/goal-git.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import type { Provider, RunRequest, RunResult } from '../src/server/providers/provider.js';
import { Hub } from '../src/server/realtime/hub.js';
import { NotificationService } from '../src/server/services/notification.service.js';
import { GoalRunner } from '../src/server/workflow/goal-runner.js';
import { pickBatch, scopesOverlap, tasksConflict } from '../src/server/workflow/scopes.js';

describe('file scopes', () => {
  it('overlap on path boundaries, ignoring globs and case', () => {
    expect(scopesOverlap('src/auth', 'src/auth/login.ts')).toBe(true);
    expect(scopesOverlap('./src/Auth/**', 'src/auth')).toBe(true);
    expect(scopesOverlap('src/auth', 'src/authz')).toBe(false);
    expect(scopesOverlap('', 'src')).toBe(true);
    expect(tasksConflict({ files: ['src/a'] }, { files: [] })).toBe(true);
  });

  it('batches ready tasks that touch different files; a task without files builds alone', () => {
    const t = (id: string, files?: string[]): { id: string; files?: string[] } => (files ? { id, files } : { id });
    expect(pickBatch([t('1', ['a']), t('2', ['a/x']), t('3', ['b']), t('4', ['c'])], 2).map((x) => x.id)).toEqual(['1', '3']);
    expect(pickBatch([t('1'), t('2', ['b'])], 3).map((x) => x.id)).toEqual(['1']);
    expect(pickBatch([t('1', ['a']), t('2')], 3).map((x) => x.id)).toEqual(['1']);
  });
});

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const goalIdOf = (prompt: string) => /goal (G-\d+)/.exec(prompt)![1];
const taskIdOf = (prompt: string) => /^# (?:Build|QA) (T-\d+)/m.exec(prompt)![1];

class ScriptProvider implements Provider {
  readonly id = 'fake';
  running = 0;
  maxRunning = 0;
  constructor(private readonly scripts: Record<string, (req: RunRequest, call: (n: string, a: Record<string, unknown>) => Promise<string>) => Promise<string>>) {}
  async run(req: RunRequest): Promise<RunResult> {
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      const call = (name: string, args: Record<string, unknown>) => req.hostTools.find((t) => t.name === name)!.handler(args);
      return { ok: true, result: await (this.scripts[req.bot.role] ?? (async () => 'ok'))(req, call) };
    } finally {
      this.running--;
    }
  }
  async listModels() {
    return [];
  }
}

describe('parallel builders', () => {
  it('builds non-overlapping tasks side by side and commits each task its own files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-par-'));
    sh(root, 'init', '-q', '-b', 'main');
    sh(root, 'config', 'user.email', 't@example.com');
    sh(root, 'config', 'user.name', 'T');
    fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
    sh(root, 'add', '-A');
    sh(root, 'commit', '-q', '-m', 'init');
    const project = new Project(root);
    project.init();
    project.config.update({ permissionMode: 'auto' });
    project.bots.create({ name: 'Developer 2', role: 'developer' });
    const hub = new Hub(project.paths.runs);
    const files: Record<string, string> = {};

    const provider = new ScriptProvider({
      planner: async (req, call) => {
        const goalId = goalIdOf(req.prompt);
        const a = JSON.parse(await call(HostTool.TaskCreate, { title: 'Part A', kind: TaskKind.Dev, goalId, files: ['src/a'] }));
        const b = JSON.parse(await call(HostTool.TaskCreate, { title: 'Part B', kind: TaskKind.Dev, goalId, files: ['src/b'] }));
        await call(HostTool.TaskCreate, { title: 'Check', kind: TaskKind.QA, goalId, dependsOn: [a.id, b.id] });
        files[a.id] = 'src/a/a.js';
        files[b.id] = 'src/b/b.js';
        return 'planned';
      },
      developer: async (req, call) => {
        const id = taskIdOf(req.prompt);
        const rel = files[id]!;
        fs.mkdirSync(path.join(req.cwd, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(req.cwd, rel), `${id}\n`);
        // A shell command's write: not tracked, so it lands in the shared batch commit.
        fs.appendFileSync(path.join(req.cwd, 'build.log'), `${id}\n`);
        await new Promise((r) => setTimeout(r, 50));
        req.emit({ type: AgentEventType.TurnChanges, botId: req.bot.id, files: [{ path: rel, status: 'added', additions: 1, deletions: 0, patch: '' }], skipped: [] });
        await call(HostTool.TaskUpdate, { id, status: TaskStatus.Review });
        return 'done';
      },
      qa: async (req, call) => {
        await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Done });
        return 'passed';
      },
      lead: async () => '## Outcome\nok',
    });
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
    });
    const runner = new GoalRunner({ project, team, hub, notifications, boardChanged: () => {} });
    const goal = runner.start('Two parts');
    const until = async (cond: () => boolean) => {
      const end = Date.now() + 8000;
      while (!cond()) {
        if (Date.now() > end) throw new Error(`timed out at ${project.goals.get(goal.id)!.status}: ${project.goals.get(goal.id)!.reason ?? ''}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await until(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    runner.approve(goal.id);
    await until(() => project.goals.get(goal.id)!.status === GoalStatus.Done);

    expect(provider.maxRunning).toBe(2);
    const dev = project.tasks.list({ goalId: goal.id }).filter((t) => t.kind === TaskKind.Dev);
    expect(new Set(dev.map((t) => t.assignee)).size).toBe(2);
    const wt = project.goals.get(goal.id)!.worktree!.path;
    for (const t of dev) {
      const touched = (await Promise.all(t.commits.map((c) => gg.filesOf(wt, c)))).flat();
      expect(touched).toContain(files[t.id]);
      expect(touched).not.toContain(Object.values(files).find((f) => f !== files[t.id]));
      expect(touched).toContain('build.log');
    }
  }, 15000);
});
