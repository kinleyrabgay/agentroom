import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as gg from '../src/server/git/goal-git.js';
import { checkBudget, WarnOnce } from '../src/server/workflow/budget.js';
import { buildPrBody, closingLines, testsLine } from '../src/server/workflow/pr-body.js';
import { GoalSchema, TaskSchema } from '../src/shared/schemas.js';

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-wt-'));
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 'test@example.com');
  sh(root, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(root, 'app.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), '');
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', 'init');
  return root;
}

describe('goal worktree', () => {
  it('creates a branch + folder, links dependencies, checkpoints, lists changes, reverts and merges', async () => {
    const root = tempRepo();
    const base = (await gg.head(root))!;
    const dir = path.join(root, '.agentroom', 'runs', 'worktrees', 'G-1');
    const branch = gg.goalBranch('G-1');
    await gg.createWorktree(root, dir, branch, base);

    expect(await gg.currentBranch(dir)).toBe('agentroom/g-1');
    expect(fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()).toBe(true);

    // A bot edits a file and adds one: the checkpoint commits both, never the dependency link.
    fs.writeFileSync(path.join(dir, 'app.js'), 'export const a = 2;\n');
    fs.writeFileSync(path.join(dir, 'b.js'), 'export const b = 1;\n');
    const sha = await gg.commitAll(dir, 'T-1: change a, add b');
    expect(sha).toBeTruthy();
    expect(await gg.filesOf(dir, sha!)).toEqual(['app.js', 'b.js']);
    expect(await gg.commitAll(dir, 'nothing')).toBeNull();

    // Uncommitted work shows up too.
    fs.writeFileSync(path.join(dir, 'c.js'), 'x\n');
    const files = await gg.changedFiles(dir, base);
    expect(files.map((f) => [f.path, f.status, f.uncommitted])).toEqual([
      ['app.js', 'modified', false],
      ['b.js', 'added', false],
      ['c.js', 'added', true],
    ]);
    expect(files.find((f) => f.path === 'app.js')!.diff).toContain('+export const a = 2;');
    fs.rmSync(path.join(dir, 'c.js'));

    // Revert the task: the files are back to the base.
    const reverts = await gg.revertCommits(dir, [sha!]);
    expect(reverts).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, 'app.js'), 'utf8')).toBe('export const a = 1;\n');
    expect(fs.existsSync(path.join(dir, 'b.js'))).toBe(false);

    // The human's working copy never changed.
    expect(fs.readFileSync(path.join(root, 'app.js'), 'utf8')).toBe('export const a = 1;\n');

    // Merge locally, then remove the folder (the branch stays).
    fs.writeFileSync(path.join(dir, 'd.js'), 'd\n');
    await gg.commitAll(dir, 'T-2: add d');
    await gg.mergeInto(root, branch, 'Merge G-1');
    expect(fs.existsSync(path.join(root, 'd.js'))).toBe(true);
    await gg.removeWorktree(root, dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(sh(root, 'branch', '--list', branch)).toContain(branch);
  });

  it('refuses to merge into a dirty working copy', async () => {
    const root = tempRepo();
    const base = (await gg.head(root))!;
    const dir = path.join(root, 'wt');
    await gg.createWorktree(root, dir, 'agentroom/g-2', base);
    fs.writeFileSync(path.join(root, 'app.js'), 'local edit\n');
    await expect(gg.mergeInto(root, 'agentroom/g-2', 'm')).rejects.toThrow(/uncommitted changes/);
  });
});

const goal = (over: Record<string, unknown> = {}) =>
  GoalSchema.parse({ id: 'G-4', title: 'Dependency rules', brief: 'b', summary: 'Implemented FULL_HIDE and WARN.', createdAt: 'x', updatedAt: 'x', ...over });
const task = (over: Record<string, unknown>) => TaskSchema.parse({ title: 't', createdAt: 'x', updatedAt: 'x', ...over });

describe('PR body', () => {
  it('closes GitHub cards (repo-qualified when needed) and fixes Sentry issues', () => {
    const g = goal({
      sources: [
        { type: 'github', itemId: 'a', number: 4781, repo: 'acme/web', title: 'x' },
        { type: 'github', itemId: 'b', number: 12, repo: 'acme/api', title: 'y' },
        { type: 'sentry', itemId: '1', shortId: 'WEB-4X', title: 'z' },
      ],
    });
    expect(closingLines(g, 'acme/web')).toEqual(['Closes #4781', 'Closes acme/api#12', 'Fixes WEB-4X']);
    const body = buildPrBody(g, [task({ id: 'T-1', title: 'Engine', kind: 'dev' }), task({ id: 'T-2', title: 'QA', kind: 'qa', status: 'done' })], 0, 'acme/web');
    expect(body).toContain('Implemented FULL_HIDE and WARN.');
    expect(body).toContain('- T-1: Engine');
    expect(body).toContain('Closes #4781');
    expect(body).toContain('Security: no open findings');
    expect(body).toContain('Tests: QA passed (1 task)');
  });

  it('summarises partial QA', () => {
    expect(testsLine([task({ id: 'T-1', kind: 'qa', status: 'done' }), task({ id: 'T-2', kind: 'qa' })])).toBe('QA: 1 of 2 tasks passed');
    expect(testsLine([])).toBeNull();
  });
});

describe('budgets', () => {
  it('uses the tighter cap and warns at the line', () => {
    expect(checkBudget({ goalCap: 5, goalSpent: 1, dayCap: 10, daySpent: 9.5, warnAt: 0.8 })).toEqual({ remaining: 0.5, exceeded: null, warn: ['day'] });
    expect(checkBudget({ goalCap: 5, goalSpent: 4.1, dayCap: null, daySpent: 0, warnAt: 0.8 }).warn).toEqual(['goal']);
    expect(checkBudget({ goalCap: null, goalSpent: 100, dayCap: null, daySpent: 100, warnAt: 0.8 })).toEqual({ remaining: Infinity, exceeded: null, warn: [] });
  });

  it('pauses when a cap is used up (day first)', () => {
    expect(checkBudget({ goalCap: 5, goalSpent: 5, dayCap: 10, daySpent: 2, warnAt: 0.8 }).exceeded).toBe('goal');
    expect(checkBudget({ goalCap: 5, goalSpent: 5, dayCap: 10, daySpent: 10, warnAt: 0.8 }).exceeded).toBe('day');
  });

  it('warns once per key', () => {
    const w = new WarnOnce();
    expect(w.first('goal:G-4:5')).toBe(true);
    expect(w.first('goal:G-4:5')).toBe(false);
    expect(w.first('goal:G-4:8')).toBe(true);
  });
});
