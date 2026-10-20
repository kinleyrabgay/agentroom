import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { merge3 } from '../src/core/packs/merge3.js';
import { INCOMING_SUFFIX, PackManager, detectMatch, findPack, listBuiltinPacks, readManifest, suggestPacks } from '../src/core/packs/packs.js';
import { Project } from '../src/core/project.js';

const tmp = (p = 'agentroom-pack-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

function project(files: Record<string, string> = {}) {
  const root = tmp();
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), c);
  }
  const p = new Project(root);
  p.init();
  return p;
}

/** A pack folder we can change between versions. */
function makePack(version: string, files: Record<string, string>, settings?: unknown) {
  const dir = tmp('agentroom-packsrc-');
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ name: 'demo', title: 'Demo', version, stacks: [], detect: { files: ['demo.txt'] } }));
  if (settings) fs.writeFileSync(path.join(dir, 'settings.partial.json'), JSON.stringify(settings));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  return dir;
}
function rewrite(dir: string, version: string, files: Record<string, string | null>) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ ...manifest, version }));
  for (const [f, c] of Object.entries(files)) {
    if (c === null) fs.rmSync(path.join(dir, f));
    else fs.writeFileSync(path.join(dir, f), c);
  }
}

describe('merge3', () => {
  const base = 'a\nb\nc\nd\ne\n';
  it('takes non-overlapping edits from both sides', () => {
    const r = merge3(base, 'a\nB-mine\nc\nd\ne\n', 'a\nb\nc\nd\nE-theirs\n');
    expect(r).toEqual({ text: 'a\nB-mine\nc\nd\nE-theirs\n', conflict: false });
  });
  it('handles insertions and deletions', () => {
    const r = merge3(base, 'a\nb\nc\nd\ne\nf-mine\n', 'zero\na\nb\nd\ne\n');
    expect(r.conflict).toBe(false);
    expect(r.text).toBe('zero\na\nb\nd\ne\nf-mine\n');
  });
  it('reports a conflict when both change the same lines and keeps ours', () => {
    const ours = 'a\nmine\nc\nd\ne\n';
    expect(merge3(base, ours, 'a\ntheirs\nc\nd\ne\n')).toEqual({ text: ours, conflict: true });
  });
  it('identical changes on both sides are not a conflict', () => {
    expect(merge3(base, 'a\nx\nc\nd\ne\n', 'a\nx\nc\nd\ne\n').conflict).toBe(false);
  });
});

describe('built-in packs', () => {
  it('ship valid manifests, bots, skills and goal templates', () => {
    const packs = listBuiltinPacks();
    expect(packs.map((p) => p.manifest.name).sort()).toEqual(['flutter-app', 'nextjs-saas']);
    for (const p of packs) {
      expect(readManifest(p.dir).version).toMatch(/^\d+\.\d+\.\d+$/);
      for (const sub of ['bots', 'skills', 'goal-templates']) expect(fs.readdirSync(path.join(p.dir, sub)).length).toBeGreaterThan(0);
    }
  });

  it('suggests packs from the stack', () => {
    const next = project({ 'package.json': JSON.stringify({ dependencies: { next: '16.0.0', react: '19' } }) });
    expect(suggestPacks(next.root).map((s) => s.pack.manifest.name)).toEqual(['nextjs-saas']);
    const flutter = project({ 'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n' });
    expect(suggestPacks(flutter.root).map((s) => s.pack.manifest.name)).toEqual(['flutter-app']);
    const dart = project({ 'pubspec.yaml': 'name: cli\ndependencies:\n  args: ^2.0.0\n' });
    expect(suggestPacks(dart.root)).toEqual([]);
    expect(detectMatch(next.root, { packageDeps: ['next'] })).toMatch(/next/);
  });

  it('init does not copy packs into the project', () => {
    const p = project();
    expect(fs.existsSync(path.join(p.paths.dir, 'packs'))).toBe(false);
  });

  it('installs the Next.js pack: bots load, skills exist, settings merged, defaults kept', () => {
    const p = project({ 'package.json': JSON.stringify({ dependencies: { next: '16.0.0' } }) });
    const r = new PackManager(p).apply(findPack('nextjs-saas'));
    expect(r.conflicts).toEqual([]);
    const bots = p.bots.list().map((b) => b.id);
    expect(bots).toEqual(expect.arrayContaining(['team-lead', 'frontend-developer', 'backend-developer', 'e2e-tester']));
    const skills = p.library.list().map((s) => s.name);
    for (const b of p.bots.list()) for (const s of b.skills) expect(skills).toContain(s);
    const sensitive = p.settings.team().security.sensitivePaths;
    expect(sensitive).toContain('**/auth/**');
    expect(sensitive).toContain('**/app/api/webhooks/**');
    const templates = p.goalTemplates.list().templates.map((t) => t.id);
    expect(templates).toEqual(expect.arrayContaining(['bug-fix', 'saas-feature', 'new-page']));
    expect(new PackManager(p).list().find((v) => v.name === 'nextjs-saas')).toMatchObject({ suggested: true, installed: { version: '1.0.0', modified: 0 } });
  });
});

describe('pack updates and removal', () => {
  const v1 = { 'skills/demo-skill/SKILL.md': '---\nname: demo-skill\ndescription: Demo skill for tests\n---\nline 1\nline 2\nline 3\nline 4\n', 'goal-templates/demo.md': '---\nname: Demo\n---\nDo it.\n' };

  it('three-way merges your edits with the new version', () => {
    const p = project();
    const src = makePack('1.0.0', v1);
    const m = new PackManager(p);
    m.apply({ manifest: readManifest(src), dir: src, origin: 'local' });
    const skill = path.join(p.paths.skills, 'demo-skill', 'SKILL.md');
    fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace('line 1', 'line 1 (my team rule)'));
    rewrite(src, '1.10.0', { 'skills/demo-skill/SKILL.md': v1['skills/demo-skill/SKILL.md'].replace('line 4', 'line 4 improved') });
    expect(m.list().find((v) => v.name === 'demo')).toMatchObject({ version: '1.10.0', origin: 'local', installed: { version: '1.0.0', updateAvailable: true, modified: 1 } });
    const r = m.update('demo');
    expect(m.list().find((v) => v.name === 'demo')?.installed?.updateAvailable).toBe(false);
    expect(r.changes.find((c) => c.path === 'skills/demo-skill/SKILL.md')?.action).toBe('merged');
    const text = fs.readFileSync(skill, 'utf8');
    expect(text).toContain('line 1 (my team rule)');
    expect(text).toContain('line 4 improved');
    expect(r.version).toBe('1.10.0');
  });

  it('keeps your file and writes the incoming copy on conflict', () => {
    const p = project();
    const src = makePack('1.0.0', v1);
    const m = new PackManager(p);
    m.apply({ manifest: readManifest(src), dir: src, origin: 'local' });
    const tpl = path.join(p.paths.goalTemplates, 'demo.md');
    fs.writeFileSync(tpl, '---\nname: Demo\n---\nDo it my way.\n');
    rewrite(src, '2.0.0', { 'goal-templates/demo.md': '---\nname: Demo\n---\nDo it the new way.\n' });
    const r = m.update('demo');
    expect(r.conflicts).toEqual(['goal-templates/demo.md']);
    expect(fs.readFileSync(tpl, 'utf8')).toContain('my way');
    expect(fs.readFileSync(tpl + INCOMING_SUFFIX, 'utf8')).toContain('new way');
    // The incoming copy isn't picked up as a template.
    expect(p.goalTemplates.list().templates.filter((t) => t.id === 'demo')).toHaveLength(1);
  });

  it('never overwrites a file that existed before the pack', () => {
    const p = project();
    fs.mkdirSync(path.join(p.paths.skills, 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(p.paths.skills, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: mine\n---\nmine\n');
    const src = makePack('1.0.0', v1);
    const m = new PackManager(p);
    const r = m.apply({ manifest: readManifest(src), dir: src, origin: 'local' });
    expect(r.conflicts).toEqual(['skills/demo-skill/SKILL.md']);
    m.remove('demo');
    expect(fs.readFileSync(path.join(p.paths.skills, 'demo-skill', 'SKILL.md'), 'utf8')).toContain('mine');
  });

  it('removes untouched files, drops files the pack no longer ships, and keeps edited ones', () => {
    const p = project();
    const src = makePack('1.0.0', { ...v1, 'skills/extra/SKILL.md': '---\nname: extra\ndescription: x\n---\nx\n' });
    const m = new PackManager(p);
    m.apply({ manifest: readManifest(src), dir: src, origin: 'local' });
    rewrite(src, '1.1.0', { 'skills/extra/SKILL.md': null });
    const up = m.update('demo');
    expect(up.changes.find((c) => c.path === 'skills/extra/SKILL.md')?.action).toBe('removed');
    expect(fs.existsSync(path.join(p.paths.skills, 'extra'))).toBe(false);

    fs.appendFileSync(path.join(p.paths.goalTemplates, 'demo.md'), 'My note.\n');
    const r = m.remove('demo');
    expect(r.changes.find((c) => c.path === 'goal-templates/demo.md')?.action).toBe('kept');
    expect(fs.existsSync(path.join(p.paths.skills, 'demo-skill'))).toBe(false);
    expect(m.installed()).toEqual({});
  });

  it('merges settings: lists item by item, values you changed are kept', () => {
    const p = project();
    p.settings.update({ budgets: { perGoalUsd: 5 } }, 'team');
    const src = makePack('1.0.0', v1, { security: { sensitivePaths: ['**/a/**', '**/b/**'] }, budgets: { perGoalUsd: 2, perDayUsd: 20 } });
    const m = new PackManager(p);
    const r1 = m.apply({ manifest: readManifest(src), dir: src, origin: 'local' });
    expect(r1.settings.kept).toEqual(['budgets.perGoalUsd']);
    let s = p.settings.team();
    expect(s.budgets.perGoalUsd).toBe(5);
    expect(s.budgets.perDayUsd).toBe(20);
    expect(s.security.sensitivePaths).toEqual(expect.arrayContaining(['**/auth/**', '**/a/**', '**/b/**']));

    p.settings.update({ security: { sensitivePaths: [...s.security.sensitivePaths, '**/mine/**'] } }, 'team');
    fs.writeFileSync(path.join(src, 'settings.partial.json'), JSON.stringify({ security: { sensitivePaths: ['**/a/**', '**/c/**'] }, budgets: { perGoalUsd: 2, perDayUsd: 30 } }));
    rewrite(src, '1.1.0', {});
    m.update('demo');
    s = p.settings.team();
    expect(s.security.sensitivePaths).toEqual(expect.arrayContaining(['**/a/**', '**/c/**', '**/mine/**', '**/auth/**']));
    expect(s.security.sensitivePaths).not.toContain('**/b/**');
    expect(s.budgets.perDayUsd).toBe(30);
    expect(s.budgets.perGoalUsd).toBe(5);
  });
});
