import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsSchema } from '../src/shared/schemas.js';
import type { ContextAsk, ContextDocPreview, ContextTour } from '../src/shared/types/index.js';
import { ContextService } from '../src/server/context/context.service.js';
import type { Answerer, AnswerResult } from '../src/server/context/knowledge.service.js';
import { contextRoutes } from '../src/server/http/routes/context.routes.js';
import {
  buildGraph,
  buildTour,
  changedSections,
  diffLines,
  docSections,
  extractCitations,
  grepIndexed,
  isUnsure,
  loadCard,
  mergeDoc,
  readBlocks,
  readIndexed,
  stripLinkTargets,
  tidyAnswer,
  type CardGenerator,
} from '../src/core/context/index.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-know-'));
  roots.push(root);
  const files: Record<string, string> = {
    'src/core/db.ts': "export function query(sql: string) {\n  return sql;\n}\nexport const POOL = 1;\n",
    'src/core/user.ts': "import { query } from './db.js';\nexport function getUser(id: string) {\n  return query(id);\n}\n",
    'src/core/auth.ts': "import { getUser } from './user.js';\nexport function login(id: string) {\n  return getUser(id);\n}\n",
    'src/api/routes.ts': "import { login } from '../core/auth.js';\nexport function handler() {\n  return login('x');\n}\nexport const A = 1;\n",
    'src/api/server.ts': "import { handler } from './routes.js';\nexport function serve() {\n  return handler();\n}\n",
    'src/api/util.ts': "import { POOL } from '../core/db.js';\nexport const B = POOL;\n",
    'src/cli/main.ts': "import { serve } from '../api/server.js';\nimport { query } from '../core/db.js';\nimport { parse } from './args.js';\nserve();\nquery(parse());\n",
    'src/cli/args.ts': "import { help } from './help.js';\nexport function parse() {\n  return help();\n}\n",
    'src/cli/help.ts': "export function help() {\n  return 'help';\n}\n",
    'test/auth.test.ts': "import { login } from '../src/core/auth.js';\nlogin('a');\n",
    'test/user.test.ts': "import { getUser } from '../src/core/user.js';\ngetUser('a');\n",
    'test/db.test.ts': "import { query } from '../src/core/db.js';\nquery('a');\n",
    '.env': 'SECRET=topsecret\n',
  };
  // Enough files that folders become their own modules (small trees merge into one).
  for (const dir of ['core', 'api', 'cli']) for (let i = 0; i < 12; i++) files[`src/${dir}/part${i}.ts`] = `export const ${dir}${i} = ${i};\n`;
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const fakeGenerator = (): CardGenerator => ({
  generate: async (prompt) => {
    const id = /# Module (\S+)/.exec(prompt)![1]!;
    const file = /^(src\/\S+\.ts) \(/m.exec(prompt)![1]!;
    return JSON.stringify({ purpose: `Module ${id}.`, entryPoints: [{ text: 'Start here', cite: [`${file}:1`] }], invariants: [], gotchas: [], howToChange: [] });
  },
});

function fakeAnswerer(text: string, seen: { system?: string; toolNames?: string[] } = {}): Answerer {
  return {
    answer: async ({ system, tools, model }): Promise<AnswerResult> => {
      seen.system = system;
      seen.toolNames = tools.map((t) => t.name);
      return { text, ok: true, costUsd: 0.004, model, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, turns: 3, tools: { context_find: 1 }, startedAt: new Date().toISOString(), durationMs: 5 };
    },
  };
}

async function setup(answer = 'Login goes through `src/core/auth.ts:2`, which calls `src/core/user.ts:2-4`.', user = 'Ana <ana@x.dev>') {
  const root = repo();
  const rows: unknown[] = [];
  const seen: { system?: string; toolNames?: string[] } = {};
  const s = SettingsSchema.parse({});
  const svc = new ContextService({ root, settings: () => s, generator: () => fakeGenerator(), answerer: fakeAnswerer(answer, seen), user: () => user, record: (r) => void rows.push(r) });
  await svc.sync({ cards: true });
  const app = new Hono();
  const audits: string[] = [];
  contextRoutes(app, svc, (_k, summary) => void audits.push(summary));
  const call = async <T,>(method: string, url: string, body?: unknown) => {
    const res = await app.request(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
    return { status: res.status, json: (await res.json()) as T };
  };
  return { root, svc, app, call, rows, seen, audits };
}

describe('answer citations', () => {
  it('checks paths, lines, ranges and shortened paths against the graph', () => {
    const g = buildGraph(repo());
    const cites = extractCitations('See `src/core/db.ts:1`, `user.ts:3`, `src/core/db.ts:99`, `src/nope.ts:2`, Node.js and `src/core/auth.ts:2-4` and `src/core/db.ts#POOL`.', g);
    const by = Object.fromEntries(cites.map((c) => [c.raw, c]));
    expect(by['src/core/db.ts:1']!.ok).toBe(true);
    expect(by['user.ts:3']).toMatchObject({ file: 'src/core/user.ts', line: 3, ok: true, moduleId: g.fileModule['src/core/user.ts'] });
    expect(by['src/core/db.ts:99']!.ok).toBe(false);
    expect(by['src/nope.ts:2']!.ok).toBe(false);
    expect(by['src/core/auth.ts:2-4']).toMatchObject({ line: 2, endLine: 4, ok: true });
    expect(by['src/core/db.ts#POOL']).toMatchObject({ line: 4, ok: true });
    expect(cites.some((c) => c.raw.startsWith('Node.js'))).toBe(false);
  });

  it('reads Markdown links to code as one citation', () => {
    const g = buildGraph(repo());
    const text = stripLinkTargets('See [`src/core/db.ts:1`](src/core/db.ts:1) and [docs](https://example.com).');
    expect(text).toBe('See `src/core/db.ts:1` and docs.');
    expect(extractCitations(text, g).map((c) => [c.raw, c.ok])).toEqual([['src/core/db.ts:1', true]]);
  });

  it('drops chatty openers but keeps real first lines', () => {
    expect(tidyAnswer('Perfect! Now I have a complete picture. Let me summarise:\n\n## Answer\n\nIt works.')).toBe('## Answer\n\nIt works.');
    expect(tidyAnswer('Goals finish in the runner.\n\nDetails.')).toBe('Goals finish in the runner.\n\nDetails.');
    expect(tidyAnswer('Let me explain.')).toBe('Let me explain.');
  });

  it('flags hedged or uncited answers as unsure', () => {
    const g = buildGraph(repo());
    expect(isUnsure('Not sure: I could not find it.', extractCitations('`src/core/db.ts:1`', g))).toBe(true);
    expect(isUnsure('It is in the db module.', [])).toBe(true);
    expect(isUnsure('Queries run in `src/core/db.ts:1`.', extractCitations('`src/core/db.ts:1`', g))).toBe(false);
  });

  it('grep and read only see indexed files (never secrets)', () => {
    const root = repo();
    const g = buildGraph(root);
    expect(grepIndexed(root, g, 'SECRET')).toEqual([]);
    expect(grepIndexed(root, g, 'getUser').map((h) => `${h.file}:${h.line}`)).toContain('src/core/user.ts:2');
    expect(grepIndexed(root, g, 'return', { path: 'src/api' }).every((h) => h.file.startsWith('src/api/'))).toBe(true);
    expect(grepIndexed(root, g, '(unclosed').length).toBe(0);
    expect(readIndexed(root, g, '.env')).toMatch(/Not an indexed file/);
    expect(readIndexed(root, g, '../../etc/passwd')).toMatch(/Not an indexed file/);
    expect(readIndexed(root, g, 'src/core/db.ts', 2, 3)).toBe('src/core/db.ts (lines 2-3 of 5)\n2    return sql;\n3  }');
  });
});

describe('Ask', () => {
  it('answers with checked citations, records cost, and keeps history per person', async () => {
    const { call, rows, seen, svc } = await setup();
    const { status, json } = await call<ContextAsk>('POST', '/context/ask', { question: 'How does login work?' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.unsure).toBe(false);
    expect(json.cites.map((c) => c.ok)).toEqual([true, true]);
    expect(json.modules[0]).toBe(svc.reader.current()!.fileModule['src/core/auth.ts']);
    expect(seen.system).toMatch(/Repository map/);
    expect(seen.toolNames).toEqual(['context_overview', 'context_module', 'context_find', 'context_deps', 'context_impact', 'code_grep', 'code_read']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ botId: 'context', costUsd: 0.004, turns: 3 });
    const hist = await call<ContextAsk[]>('GET', '/context/asks');
    expect(hist.json.map((a) => a.id)).toEqual([json.id]);
  });

  it("hides other people's questions", async () => {
    const a = await setup(undefined, 'Ana <ana@x.dev>');
    await a.call('POST', '/context/ask', { question: 'Q1?' });
    const other = new ContextService({ root: a.root, settings: () => SettingsSchema.parse({}), user: () => 'Bo <bo@x.dev>' });
    expect(other.knowledge.history()).toEqual([]);
    expect(a.svc.knowledge.history()).toHaveLength(1);
  });

  it('pins an answer into module notes without losing earlier notes', async () => {
    const { call, root, svc } = await setup();
    const asked = (await call<ContextAsk>('POST', '/context/ask', { question: 'How does login work?' })).json;
    const mod = asked.modules[0]!;
    svc.setNotes(mod, 'Never call the db directly.');
    const pinned = await call<ContextAsk>('POST', `/context/asks/${asked.id}/pin`, { moduleId: mod });
    expect(pinned.json.pinnedTo).toBe(mod);
    const notes = loadCard(root, mod)!.humanNotes;
    expect(notes.startsWith('Never call the db directly.\n- **How does login work?**')).toBe(true);
    expect(notes).toMatch(/src\/core\/auth\.ts:2/);
  });

  it('rejects empty questions and unknown modules', async () => {
    const { call } = await setup();
    expect((await call('POST', '/context/ask', { question: '  ' })).status).toBe(400);
    const asked = (await call<ContextAsk>('POST', '/context/ask', { question: 'x?' })).json;
    expect((await call('POST', `/context/asks/${asked.id}/pin`, { moduleId: 'nope' })).status).toBe(400);
  });
});

describe('generated docs', () => {
  it('previews without writing, then writes only on request', async () => {
    const { call, root, audits } = await setup();
    const prev = (await call<ContextDocPreview[]>('GET', '/context/docs')).json;
    const arch = prev.find((p) => p.id === 'architecture')!;
    expect(arch.exists).toBe(false);
    expect(arch.sections.map((s) => s.id)).toEqual(['overview', 'diagram', 'modules', 'flows']);
    expect(arch.sections.every((s) => s.changed)).toBe(true);
    expect(arch.added).toBeGreaterThan(10);
    expect(fs.existsSync(path.join(root, 'docs/architecture.md'))).toBe(false);

    const written = (await call<ContextDocPreview>('POST', '/context/docs/architecture/write', {})).json;
    expect(written.diff).toEqual([]);
    const text = fs.readFileSync(path.join(root, 'docs/architecture.md'), 'utf8');
    expect(text).toMatch(/```mermaid\nflowchart LR/);
    expect(text).toMatch(/Call paths/);
    expect(text).toMatch(/src-cli/);
    expect(audits.some((a) => a.includes('docs/architecture.md'))).toBe(true);
  });

  it('regenerates one section and keeps human text outside the markers', () => {
    const g = buildGraph(repo());
    const input = { graph: g, cards: {}, repoName: 'demo' };
    const sections = docSections('architecture', input);
    const first = mergeDoc('architecture', null, sections);
    const edited = first.replace('# Architecture', '# Architecture\n\nWritten by a human.').replace(/(<!-- agentroom:begin flows -->)[\s\S]*?(<!-- agentroom:end flows -->)/, '$1\nold flows\n$2');
    const tampered = edited.replace(/(<!-- agentroom:begin overview -->)[\s\S]*?(<!-- agentroom:end overview -->)/, '$1\nold overview\n$2');
    expect([...changedSections(tampered, sections)].sort()).toEqual(['flows', 'overview']);
    const next = mergeDoc('architecture', tampered, sections, ['flows']);
    expect(next).toContain('Written by a human.');
    expect(readBlocks(next).overview).toBe('old overview');
    expect(readBlocks(next).flows).toContain('## Key flows');
  });

  it('collects decisions newest first', () => {
    const g = buildGraph(repo());
    const ids = Object.keys(g.modules);
    const card = (decisions: string[]) => ({ purpose: '', entryPoints: [], invariants: [], gotchas: [], howToChange: [], decisions, rejected: [], humanNotes: '', sources: {}, surfaceHash: '', generatedAt: '', generatedAtSha: null, id: '' });
    const s = docSections('decisions', { graph: g, cards: { [ids[0]!]: card(['2026-01-02 · Old one']), [ids[1]!]: card(['2026-03-04 · New one']) } as never, repoName: 'x' });
    const recent = s.find((x) => x.id === 'recent')!.body;
    expect(recent.indexOf('New one')).toBeLessThan(recent.indexOf('Old one'));
  });

  it('diffs lines with context and gaps', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const b = a.replace('l10', 'L10');
    const d = diffLines(a, b);
    expect(d.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['l10']);
    expect(d.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['L10']);
    expect(d[0]).toMatchObject({ kind: 'gap' });
    expect(d.findIndex((l) => l.kind === 'del')).toBeLessThan(d.findIndex((l) => l.kind === 'add'));
    expect(diffLines(a, a)).toEqual([]);
  });
});

describe('tour', () => {
  it('orders entry points, then core, then features, then tests', () => {
    const g = buildGraph(repo());
    const steps = buildTour(g, {});
    const stage = Object.fromEntries(steps.map((s) => [s.dir, s.stage]));
    expect(steps[0]!.dir).toBe('src/cli');
    expect(stage['src/cli']).toBe('start');
    expect(stage['test']).toBe('edges');
    expect(steps.findIndex((s) => s.dir === 'test')).toBe(steps.length - 1);
    for (const s of steps.filter((x) => x.stage !== 'edges')) expect(s.keyFiles.length).toBeGreaterThan(0);
  });

  it('keeps progress per person', async () => {
    const { call, root } = await setup();
    const t = (await call<ContextTour>('GET', '/context/tour')).json;
    const first = t.steps[0]!.moduleId;
    const after = (await call<ContextTour>('PATCH', '/context/tour', { done: { [first]: true }, current: t.steps[1]!.moduleId })).json;
    expect(after.done).toEqual([first]);
    expect(after.current).toBe(t.steps[1]!.moduleId);
    const other = new ContextService({ root, settings: () => SettingsSchema.parse({}), user: () => 'Bo' });
    expect(other.knowledge.tour().done).toEqual([]);
    expect((await call('PATCH', '/context/tour', { done: { [first]: 'yes' } })).status).toBe(400);
  });
});
