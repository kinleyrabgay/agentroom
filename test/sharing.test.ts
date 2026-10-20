import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateBoard } from '../src/core/migrations.js';
import { ProjectPaths } from '../src/core/paths.js';
import { Project } from '../src/core/project.js';
import { FsConfigRepository } from '../src/core/repositories/config.repository.js';
import { FsSettingsRepository } from '../src/core/repositories/settings.repository.js';
import { excludeFile, makePrivate, removePrivate, sharingMode } from '../src/core/sharing.js';

const tmp = (p = 'agentroom-share-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const board = { version: 2, goals: [{ id: 'G-1' }], tasks: [] };

describe('board migration', () => {
  it('moves tasks/board.json to runs/board.json once and removes the empty folder', () => {
    const paths = new ProjectPaths(tmp());
    fs.mkdirSync(path.dirname(paths.legacyTasksFile), { recursive: true });
    fs.writeFileSync(paths.legacyTasksFile, JSON.stringify(board));
    expect(migrateBoard(paths)).toMatch(/Moved goals and tasks/);
    expect(JSON.parse(fs.readFileSync(paths.tasksFile, 'utf8'))).toEqual(board);
    expect(fs.existsSync(paths.legacyTasksFile)).toBe(false);
    expect(fs.existsSync(path.dirname(paths.legacyTasksFile))).toBe(false);
    expect(migrateBoard(paths)).toBeNull();
  });

  it('never moves a broken file and keeps both when both exist', () => {
    const paths = new ProjectPaths(tmp());
    fs.mkdirSync(path.dirname(paths.legacyTasksFile), { recursive: true });
    fs.writeFileSync(paths.legacyTasksFile, '{broken');
    expect(() => migrateBoard(paths)).toThrow();
    expect(fs.existsSync(paths.legacyTasksFile)).toBe(true);
    expect(fs.existsSync(paths.tasksFile)).toBe(false);

    fs.writeFileSync(paths.legacyTasksFile, JSON.stringify(board));
    fs.mkdirSync(paths.runs, { recursive: true });
    fs.writeFileSync(paths.tasksFile, JSON.stringify({ version: 2, goals: [], tasks: [] }));
    expect(migrateBoard(paths)).toMatch(/Warning/);
    expect(fs.existsSync(paths.legacyTasksFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(paths.tasksFile, 'utf8')).goals).toEqual([]);
  });

  it('new projects keep the board in runs/', () => {
    const p = new Project(tmp());
    p.init();
    expect(fs.existsSync(path.join(p.paths.runs, 'board.json'))).toBe(true);
    expect(fs.existsSync(path.join(p.paths.dir, 'tasks'))).toBe(false);
  });
});

describe('personal settings', () => {
  const setup = () => {
    const dir = tmp();
    return { dir, repo: new FsSettingsRepository(path.join(dir, 'settings.json'), path.join(dir, 'runs', 'settings.local.json')) };
  };

  it('overlays personal values over the team settings and lists the overrides', () => {
    const { dir, repo } = setup();
    repo.update({ budgets: { perGoalUsd: 5, perDayUsd: 20 }, models: { build: { model: 'claude-sonnet-5-5' } } } as never);
    repo.update({ budgets: { perDayUsd: 3 }, models: { build: {} } } as never, 'personal');
    const merged = repo.get();
    expect(merged.budgets).toMatchObject({ perGoalUsd: 5, perDayUsd: 3 });
    // A personal phase choice replaces the team's (here: "bot's own setting").
    expect(merged.models.build).toEqual({});
    expect(repo.team().budgets.perDayUsd).toBe(20);
    expect(repo.overrides().sort()).toEqual(['budgets.perDayUsd', 'models.build']);
    // The local file only holds what you changed.
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'runs', 'settings.local.json'), 'utf8'))).toEqual({ budgets: { perDayUsd: 3 }, models: { build: {} } });
  });

  it('resets a personal key back to the team value', () => {
    const { repo } = setup();
    repo.update({ budgets: { perDayUsd: 20 } } as never);
    repo.update({ budgets: { perDayUsd: 3 } } as never, 'personal');
    expect(repo.resetPersonal('budgets.perDayUsd').budgets.perDayUsd).toBe(20);
    expect(repo.overrides()).toEqual([]);
  });

  it('config: personal by default, team on request', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 4317, permissionMode: 'ask-writes' }));
    const repo = new FsConfigRepository(path.join(dir, 'config.json'), path.join(dir, 'config.local.json'));
    repo.update({ permissionMode: 'auto' as never });
    expect(repo.get().permissionMode).toBe('auto');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).permissionMode).toBe('ask-writes');
    repo.update({ port: 5000 }, 'team');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).port).toBe(5000);
  });
});

describe('private mode', () => {
  const repo = () => {
    const dir = tmp('agentroom-private-');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
  };

  it('excludes .agentroom/ locally, idempotently, and share() undoes it', () => {
    const dir = repo();
    expect(sharingMode(dir)).toBe('team');
    expect(makePrivate(dir)).toBe(true);
    expect(makePrivate(dir)).toBe(true);
    const exclude = fs.readFileSync(excludeFile(dir)!, 'utf8');
    expect(exclude.match(/\/\.agentroom\//g)).toHaveLength(1);
    expect(sharingMode(dir)).toBe('private');
    removePrivate(dir);
    removePrivate(dir);
    expect(fs.readFileSync(excludeFile(dir)!, 'utf8')).not.toMatch(/agentroom/);
    expect(sharingMode(dir)).toBe('team');
  });

  it('init --private leaves .gitignore alone; share() adds runs/ to it', () => {
    const dir = repo();
    const p = new Project(dir);
    p.init({ private: true });
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
    expect(p.sharing()).toBe('private');
    p.share();
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toMatch(/\.agentroom\/runs\//);
    expect(p.sharing()).toBe('team');
  });
});
