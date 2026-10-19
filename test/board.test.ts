import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Project } from '../src/core/project.js';
import { TaskKind, TaskStatus } from '../src/shared/enums.js';

let root: string;
let p: Project;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-board-'));
  p = new Project(root);
  p.init();
});

describe('board', () => {
  it('starts as a v2 board', () => {
    expect(JSON.parse(fs.readFileSync(p.paths.tasksFile, 'utf8'))).toEqual({ version: 2, goals: [], tasks: [] });
  });

  it('migrates a v1 task array on read and writes v2', () => {
    fs.writeFileSync(p.paths.tasksFile, JSON.stringify([{ id: 'T-1', title: 'Old', status: 'doing', createdAt: 'x', updatedAt: 'x' }]));
    const [t] = p.tasks.list();
    expect(t).toMatchObject({ id: 'T-1', title: 'Old', status: TaskStatus.Doing, kind: TaskKind.Dev, acceptance: [], log: [] });
    p.tasks.create({ title: 'New' });
    const raw = JSON.parse(fs.readFileSync(p.paths.tasksFile, 'utf8'));
    expect(raw.version).toBe(2);
    expect(raw.tasks.map((x: { id: string }) => x.id)).toEqual(['T-1', 'T-2']);
  });

  it('creates rich tasks with acceptance strings and per-goal order', () => {
    const g = p.goals.create({ title: 'G', brief: 'b' });
    const a = p.tasks.create({ title: 'A', goalId: g.id, acceptance: ['works', { text: 'tested', done: true }], files: ['src/a.ts'] });
    const b = p.tasks.create({ title: 'B', goalId: g.id, kind: TaskKind.QA, dependsOn: [a.id] });
    expect(a.acceptance).toEqual([{ text: 'works', done: false }, { text: 'tested', done: true }]);
    expect([a.order, b.order]).toEqual([1, 2]);
    expect(p.tasks.list({ goalId: g.id })).toHaveLength(2);
  });

  it('updates with appendLog, acceptance ticks and null clears', () => {
    const t = p.tasks.create({ title: 'A', assignee: 'developer', acceptance: ['x', 'y'] });
    p.tasks.update(t.id, { blockedReason: 'need key' });
    p.tasks.appendLog(t.id, 'developer', 'started');
    p.tasks.tickAcceptance(t.id, [1]);
    const u = p.tasks.update(t.id, { assignee: null, blockedReason: '' });
    expect(u.assignee).toBeUndefined();
    expect(u.blockedReason).toBeUndefined();
    expect(u.log.map((l) => l.text)).toEqual(['started']);
    expect(u.acceptance.map((a) => a.done)).toEqual([false, true]);
  });

  it('deleting a goal deletes its tasks; deleting a task drops dangling deps', () => {
    const g = p.goals.create({ title: 'G', brief: 'b' });
    const a = p.tasks.create({ title: 'A', goalId: g.id });
    const free = p.tasks.create({ title: 'Free', dependsOn: [a.id] });
    p.tasks.delete(a.id);
    expect(p.tasks.get(free.id)!.dependsOn).toEqual([]);
    p.tasks.create({ title: 'B', goalId: g.id });
    p.goals.delete(g.id);
    expect(p.goals.list()).toEqual([]);
    expect(p.tasks.list().map((t) => t.title)).toEqual(['Free']);
  });
});

describe('task_create defaults', () => {
  it('fills goal, kind and description models leave out', async () => {
    const { withTaskDefaults } = await import('../src/server/agents/tools/task.tools.js');
    const roleOf = (id: string) => ({ qa: 'qa', developer: 'developer' })[id];
    expect(withTaskDefaults({ title: 'Add x', assignee: 'developer', notes: 'desc' }, { goalId: 'G-1', roleOf })).toMatchObject({
      goalId: 'G-1', kind: TaskKind.Dev, description: 'desc',
    });
    expect(withTaskDefaults({ title: 'Verify x', assignee: 'qa' }, { roleOf }).kind).toBe(TaskKind.QA);
    expect(withTaskDefaults({ title: 'Bug: x crashes' }, {}).kind).toBe(TaskKind.Bug);
    expect(withTaskDefaults({ title: 'QA: check', goalId: 'G-9' }, { goalId: 'G-1' })).toMatchObject({ kind: TaskKind.QA, goalId: 'G-9' });
  });
});
