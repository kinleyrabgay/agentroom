import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Project } from '../src/core/project.js';
import { EffortLevel, SkillScope, TaskStatus } from '../src/shared/enums.js';

let root: string;
let p: Project;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-'));
  p = new Project(root);
  p.init();
});

describe('Project', () => {
  it('scaffolds default team, skills, plugin manifest and gitignore', () => {
    expect(p.bots.list().map((b) => b.id)).toEqual(['team-lead', 'planner', 'developer', 'qa', 'reviewer']);
    expect(p.library.list().map((s) => s.name)).toContain('git-workflow');
    expect(p.library.list()[0].scope).toBe(SkillScope.Library);
    expect(fs.existsSync(path.join(p.paths.dir, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('.agentroom/runs/');
  });

  it('init is idempotent and does not clobber edits', () => {
    p.bots.update('qa', { name: 'Quality' });
    expect(p.init()).toEqual([]);
    expect(p.bots.get('qa')!.name).toBe('Quality');
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').match(/runs\//g)!.length).toBe(1);
  });

  it('round-trips bot edits through bot.md and ignores identity fields', () => {
    p.bots.update('developer', { skills: ['testing'], prompt: 'Hello', ...({ id: 'x', dir: 'y', order: 9 } as object) });
    const b = new Project(root).bots.get('developer')!;
    expect(b.skills).toEqual(['testing']);
    expect(b.prompt).toBe('Hello');
    expect(b).toMatchObject({ id: 'developer', dir: '03-developer', order: 3 });
  });

  it('writes readable frontmatter that survives tricky values', () => {
    p.bots.update('qa', { avatar: '🧪', name: 'QA: "strict"', role: 'true' });
    const raw = fs.readFileSync(p.paths.botFile('04-qa'), 'utf8');
    expect(raw).toContain('🧪');
    expect(new Project(root).bots.get('qa')).toMatchObject({ avatar: '🧪', name: 'QA: "strict"', role: 'true' });
    p.library.save({ name: 'x', description: 'Use when: a, b # c', body: 'hi' });
    expect(p.library.get('x')!.description).toBe('Use when: a, b # c');
  });

  it('stores model and effort, and clears them with null or empty string', () => {
    p.bots.update('qa', { model: 'sonnet', effort: EffortLevel.High });
    const raw = fs.readFileSync(p.paths.botFile('04-qa'), 'utf8');
    expect(raw).toMatch(/model: sonnet\neffort: high\nreportsTo: team-lead/);
    expect(new Project(root).bots.get('qa')).toMatchObject({ model: 'sonnet', effort: 'high' });

    p.bots.update('qa', { model: null, effort: '' } as never);
    const cleared = new Project(root).bots.get('qa')!;
    expect(cleared.model).toBeUndefined();
    expect(cleared.effort).toBeUndefined();
    expect(fs.readFileSync(p.paths.botFile('04-qa'), 'utf8')).not.toMatch(/model:|effort:/);

    p.bots.update('qa', { reportsTo: null } as never);
    expect(new Project(root).bots.get('qa')!.reportsTo).toBeUndefined();
  });

  it('creates bots with next number and removes deleted library skills from bots', () => {
    const b = p.bots.create({ name: 'Security Auditor', role: 'security' });
    expect(b.dir).toBe('06-security-auditor');
    expect(b.reportsTo).toBe('team-lead');
    expect(b.localSkills).toEqual([]);
    p.deleteLibrarySkill('testing');
    expect(p.bots.list().some((x) => x.skills.includes('testing'))).toBe(false);
  });

  it('rejects path traversal in skill names', () => {
    expect(() => p.deleteLibrarySkill('../bots')).toThrow();
    expect(() => p.library.save({ name: '../../x', description: '', body: '' })).not.toThrow(); // slugified to "x"
    expect(() => p.saveBotSkill('qa', { name: '..', description: '', body: '' })).toThrow();
    expect(() => p.deleteBotSkill('qa', '../../skills')).toThrow();
  });

  it('manages tasks', () => {
    const t = p.tasks.create({ title: 'A' });
    expect(t.id).toBe('T-1');
    expect(p.tasks.create({ title: 'B' }).id).toBe('T-2');
    expect(p.tasks.update('T-1', { status: TaskStatus.Done }).status).toBe('done');
  });
});

describe('bot-local skills', () => {
  it('saves, lists and deletes skills in the bot folder and makes it a plugin', () => {
    const s = p.saveBotSkill('qa', { name: 'e2e-check', description: 'Use for e2e', body: '# Steps' });
    expect(s).toMatchObject({ name: 'e2e-check', scope: SkillScope.Bot, botId: 'qa' });
    expect(fs.existsSync(path.join(p.paths.botSkills('04-qa'), 'e2e-check', 'SKILL.md'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(p.paths.botPluginManifest('04-qa'), 'utf8'));
    expect(manifest.name).toBe('agentroom-bot-qa');

    const qa = new Project(root).bots.get('qa')!;
    expect(qa.localSkills.map((x) => x.name)).toEqual(['e2e-check']);
    expect(qa.localSkills[0]).toMatchObject({ description: 'Use for e2e', body: '# Steps' });

    p.deleteBotSkill('qa', 'e2e-check');
    expect(p.bots.get('qa')!.localSkills).toEqual([]);
  });

  it('customize copies a library skill into the bot and drops the assignment', () => {
    expect(p.bots.get('developer')!.skills).toContain('testing');
    const dev = p.customizeSkill('developer', 'testing');
    expect(dev.skills).not.toContain('testing');
    expect(dev.localSkills.map((s) => s.name)).toContain('testing');
    expect(p.library.get('testing')).toBeDefined();
    expect(() => p.customizeSkill('developer', 'testing')).toThrow(/already has/);
    expect(() => p.customizeSkill('developer', 'nope')).toThrow(/not found/);
  });
});
