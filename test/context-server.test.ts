import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsSchema } from '../src/shared/schemas.js';
import type { Settings } from '../src/shared/types/index.js';
import { ContextService } from '../src/server/context/context.service.js';
import { contextRoutes } from '../src/server/http/routes/context.routes.js';
import { contextTools } from '../src/server/agents/tools/context.tools.js';
import { buildContext } from '../src/server/agents/context-builder.js';
import { HostTool } from '../src/shared/enums.js';
import { EXPORT_END, EXPORT_START, loadCard, upsertContextBlock, type CardGenerator } from '../src/core/context/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-ctxs-'));
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function repo(): string {
  const root = tmp();
  roots.push(root);
  const files: Record<string, string> = {
    'src/core/db.ts': "export function query(sql: string) {\n  return sql;\n}\nexport const POOL = 1;\n",
    'src/core/user.ts': "import { query } from './db.js';\nexport function getUser(id: string) {\n  return query(id);\n}\n",
    'src/core/auth.ts': "import { getUser } from './user.js';\nexport function login(id: string) {\n  return getUser(id);\n}\n",
    'src/api/routes.ts': "import { login } from '../core/auth.js';\nexport function handler() {\n  return login('x');\n}\nexport const A = 1;\n",
    'src/api/server.ts': "import { handler } from './routes.js';\nexport function serve() {\n  return handler();\n}\n",
    'src/api/util.ts': 'export const B = 2;\n',
    'test/auth.test.ts': "import { login } from '../src/core/auth.js';\nlogin('a');\n",
    '.agentroom/runs/secrets.json': '{"token":"shh"}',
    '.env': 'SECRET=1\n',
    'config/.env.local': 'SECRET=2\n',
    'deploy/server.pem': 'KEY\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function settings(patch: Partial<Settings['context']> = {}): () => Settings {
  const s = SettingsSchema.parse({ context: patch });
  return () => s;
}

const fakeGenerator = (): CardGenerator => ({
  generate: async (prompt) => {
    const id = /# Module (\S+)/.exec(prompt)![1]!;
    const file = /^(src\/\S+\.ts) \(/m.exec(prompt)![1]!;
    return JSON.stringify({
      purpose: `Module ${id}.`,
      entryPoints: [{ text: 'Start here', cite: [file] }],
      invariants: [{ text: 'Keep it pure', cite: [`${file}:1`] }],
      gotchas: [],
      howToChange: [],
    });
  },
});

async function setup(opts: { cards?: boolean } = {}) {
  const root = repo();
  const svc = new ContextService({ root, settings: settings(), generator: () => fakeGenerator(), autoSyncDelayMs: 10 });
  await svc.sync({ cards: opts.cards ?? false });
  const app = new Hono();
  const audits: string[] = [];
  contextRoutes(app, svc, (_k, summary) => void audits.push(summary));
  return { root, svc, app, audits };
}

describe('ContextService', () => {
  it('builds facts without a model and reports status', async () => {
    const { svc } = await setup();
    const st = svc.status();
    expect(st.built).toBe(true);
    expect(st.files).toBeGreaterThanOrEqual(7);
    expect(st.cards.missing).toBe(st.modules);
    expect(st.tokensIndex).toBeGreaterThan(10);
    expect(svc.graph().modules.length).toBe(st.modules);
    expect(svc.promptBlock()).toContain('# Repo map');
  });

  it('writes cards, shows them with resolved citations, and takes human feedback', async () => {
    const { svc, root } = await setup({ cards: true });
    const d = svc.module('src/core/db.ts');
    const core = d;
    expect(core.status).toBe('fresh');
    expect(d.sections.entryPoints[0]!.cite[0]!.ok).toBe(true);
    expect(d.fileFacts.map((f) => f.path)).toContain('src/core/db.ts');

    const after = svc.reject(core.id, 'invariants', 0, 'it is not pure');
    expect(after.sections.invariants).toHaveLength(0);
    expect(after.rejected[0]).toContain('it is not pure');
    expect(svc.setNotes(core.id, 'All SQL goes through db.ts').humanNotes).toBe('All SQL goes through db.ts');
    expect(svc.setDecisions(core.id, ['2026-10-20 · one', '  ', '2026-10-21 · two']).decisions).toEqual(['2026-10-20 · one', '2026-10-21 · two']);
    // A regeneration keeps notes, decisions and rejected claims.
    await svc.sync({ cards: true, only: [core.id] });
    const card = loadCard(root, core.id)!;
    expect(card.humanNotes).toBe('All SQL goes through db.ts');
    expect(card.decisions).toHaveLength(2);
    expect(card.rejected).toHaveLength(1);
  });

  it('notes a finished goal in the cards of the modules it touched', async () => {
    const { svc, root } = await setup();
    const touched = svc.onGoalDone({ id: 'G-3', title: 'Faster login', summary: '## Report\nLogin now caches users. More text.' }, ['src/core/auth.ts', 'src/core/new-file.ts']);
    expect(touched).toEqual([svc.module('src/core/auth.ts').id]);
    const card = loadCard(root, touched[0]!)!;
    expect(card.decisions[0]).toMatch(/G-3 Faster login: Login now caches users\./);
    svc.stop();
  });
});

describe('context routes', () => {
  it('code peek only serves indexed files inside the repo', async () => {
    const { app } = await setup();
    const ok = await app.request('/context/file?path=src/core/db.ts&line=2');
    expect(ok.status).toBe(200);
    const peek = (await ok.json()) as { lines: string[]; focus: number; start: number };
    expect(peek.focus).toBe(2);
    expect(peek.lines[0]).toContain('export function query');
    for (const bad of ['../../etc/passwd', '/etc/passwd', 'src/../../x', '.agentroom/runs/secrets.json', '.env', 'config/.env.local', 'deploy/server.pem', 'src%2F..%2F..%2Fetc%2Fpasswd', 'src\\..\\..\\x']) {
      const r = await app.request(`/context/file?path=${encodeURIComponent(bad)}`);
      expect(r.status, bad).toBe(400);
    }
  });

  it('search, impact and sync', async () => {
    const { app, audits } = await setup();
    const hits = (await (await app.request('/context/find?q=getUser')).json()) as { kind: string; path: string; line?: number }[];
    expect(hits[0]).toMatchObject({ kind: 'symbol', path: 'src/core/user.ts', line: 2 });
    const impact = (await (
      await app.request('/context/impact', { method: 'POST', body: JSON.stringify({ files: ['src/core/db.ts'] }), headers: { 'content-type': 'application/json' } })
    ).json()) as { files: string[]; tests: string[] };
    expect(impact.files).toEqual(expect.arrayContaining(['src/core/user.ts', 'src/core/auth.ts', 'src/api/routes.ts']));
    expect(impact.tests).toContain('test/auth.test.ts');
    const sync = await app.request('/context/sync', { method: 'POST', body: JSON.stringify({ cards: false }), headers: { 'content-type': 'application/json' } });
    expect(sync.status).toBe(200);
    expect(audits.some((a) => a.includes('Repo context sync'))).toBe(true);
    const bad = await app.request('/context/module/nope/claims/gotchas/0/reject', { method: 'POST', body: '{}' });
    expect(bad.status).toBe(400);
  });
});

describe('context tools', () => {
  it('answer as compact text and map deps direction', async () => {
    const { svc } = await setup();
    const tools = Object.fromEntries(contextTools(svc.reader).map((t) => [t.name, t]));
    expect(Object.keys(tools)).toEqual([HostTool.ContextOverview, HostTool.ContextModule, HostTool.ContextFind, HostTool.ContextDeps, HostTool.ContextImpact]);
    expect(await tools[HostTool.ContextFind]!.handler({ query: 'login' })).toContain('src/core/auth.ts:2');
    expect(await tools[HostTool.ContextDeps]!.handler({ target: 'src/core/user.ts', direction: 'uses' })).toContain('src/core/db.ts');
    expect(await tools[HostTool.ContextDeps]!.handler({ target: 'src/core/user.ts', direction: 'used_by' })).toContain('src/core/auth.ts');
    expect(await tools[HostTool.ContextModule]!.handler({ target: 'src/core/db.ts' })).toContain('No card yet');
    expect(await tools[HostTool.ContextImpact]!.handler({ files: ['nope.ts'] })).toContain('None of these files are indexed');
  });

  it('a missing context is an answer, not an error', async () => {
    const root = repo();
    const svc = new ContextService({ root, settings: settings() });
    const find = contextTools(svc.reader).find((t) => t.name === HostTool.ContextFind)!;
    expect(await find.handler({ query: 'x' })).toContain('agentroom context build');
    expect(svc.promptBlock()).toBe('');
  });

  it('puts the repo map in the instructions only when given', () => {
    const bot = { id: 'dev', name: 'Dev', role: 'developer', tools: [], reportsTo: null } as never;
    expect(buildContext(bot, [bot], '/nope/CLAUDE.md', [], '', '# Repo map: x')).toContain('## Repository map');
    expect(buildContext(bot, [bot], '/nope/CLAUDE.md')).not.toContain('Repository map');
  });
});

describe('context export', () => {
  it('replaces only its own marked block and is idempotent', () => {
    const user = '# My project\n\nDo things my way.\n';
    const once = upsertContextBlock(user, '# Repo map: a\n- m1');
    expect(once.startsWith(user.trimEnd())).toBe(true);
    expect(once).toContain(EXPORT_START);
    expect(upsertContextBlock(once, '# Repo map: a\n- m1')).toBe(once);
    const edited = once + '\n## Later notes\nkeep me\n';
    const twice = upsertContextBlock(edited, '# Repo map: a\n- m2');
    expect(twice).toContain('- m2');
    expect(twice).not.toContain('- m1');
    expect(twice).toContain('keep me');
    expect(twice.split(EXPORT_END)).toHaveLength(2);
    expect(upsertContextBlock('', 'x')).toContain(EXPORT_START);
  });
});
