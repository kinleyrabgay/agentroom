import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendDecision,
  buildCardPrompt,
  buildGraph,
  checkCitation,
  ContextReader,
  contextPaths,
  estimateTokens,
  extractFile,
  loadCard,
  loadGraph,
  needsRegeneration,
  parseCard,
  partitionModules,
  renderCard,
  renderIndex,
  setHumanNotes,
  staleness,
  syncContext,
  updateGraph,
  validateCitations,
  type CardGenerator,
  type ContextGraph,
} from '../src/core/context/index.js';
import { maskSource } from '../src/core/context/lexer.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-ctx-'));

function write(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}

const names = (rel: string, src: string) => extractFile(rel, src).symbols.map((s) => `${s.kind}:${s.name}${s.exported ? '' : '(local)'}`);

/** Strips run-specific fields so two graphs can be compared. */
const facts = (g: ContextGraph) => ({ files: g.files, modules: g.modules, edges: g.edges, fileModule: g.fileModule });

describe('lexer', () => {
  it('blanks comments, keeps line structure, optionally blanks strings', () => {
    const src = 'const a = "x // y"; // gone\n/* multi\nline */ b';
    const code = maskSource(src, 'ts', false);
    expect(code.length).toBe(src.length);
    expect(code).toContain('"x // y"');
    expect(code).not.toContain('gone');
    expect(code.split('\n')).toHaveLength(3);
    expect(maskSource(src, 'ts', true)).toContain('"      "');
  });
});

describe('extract', () => {
  it('TypeScript: imports with names, exports, components, locals, and ignores code inside strings', () => {
    const src = [
      "import { a, b as c } from './x.js';",
      "import def, * as ns from '../y';",
      "import type { T } from '@/types';",
      "export * from './z';",
      "import './side';",
      'const prompt = `',
      "import { fake } from 'not-real';",
      '`;',
      '// export function commented() {}',
      'export async function load(id: string,',
      '  opts: Opts): Promise<void> {}',
      'export const Button = memo(() => null);',
      'export const helper = (n: number) => n * 2;',
      'export default class Store {}',
      'interface Local { a: 1 }',
      'export type Id = string;',
      'export enum Color { Red }',
      'function Panel() { return null }',
      'export { Panel };',
    ].join('\n');
    const e = extractFile('src/ui/thing.tsx', src);
    expect(e.raw.map((r) => r.spec).sort()).toEqual(['../y', './side', './x.js', './z', '@/types']);
    expect(e.raw.find((r) => r.spec === './x.js')!.names).toEqual(['a', 'b']);
    expect(e.raw.find((r) => r.spec === '../y')!.names.sort()).toEqual(['*', 'default']);
    expect(names('src/ui/thing.tsx', src)).toEqual([
      'const:prompt(local)',
      'function:load',
      'component:Button',
      'function:helper',
      'class:Store',
      'interface:Local(local)',
      'type:Id',
      'enum:Color',
      'component:Panel',
    ]);
    const load = e.symbols.find((s) => s.name === 'load')!;
    expect(load.line).toBe(10);
    expect(load.signature).toBe('export async function load(id: string, opts: Opts): Promise<void>');
  });

  it('detects hono/express routes and Next app routes', () => {
    const hono = "import { Hono } from 'hono';\nconst app = new Hono();\napp.get('/api/items', (c) => c.json([]));\napp.post('/api/items/:id', h);\naxios.get('/not-a-route');";
    expect(extractFile('src/server.ts', hono).symbols.filter((s) => s.kind === 'route').map((s) => `${s.name}@${s.line}`)).toEqual(['GET /api/items@3', 'POST /api/items/:id@4']);
    const next = 'export async function GET(req: Request) {}\nexport async function POST() {}';
    expect(
      extractFile('app/(shop)/orders/[id]/route.ts', next)
        .symbols.filter((s) => s.kind === 'route')
        .map((s) => s.name),
    ).toEqual(['GET /orders/[id]', 'POST /orders/[id]']);
  });

  it('Python: imports, defs, classes, constants, FastAPI routes; docstrings ignored', () => {
    const src = [
      'from .models import User, Order as O',
      'from ..core import (',
      '    a,',
      '    b,',
      ')',
      'import os, json as j',
      '"""',
      'def not_real(): pass',
      '"""',
      'MAX_ITEMS = 10',
      '@router.get("/users/{id}")',
      'async def get_user(id: int) -> User:',
      '    pass',
      'class _Private: pass',
    ].join('\n');
    const e = extractFile('app/api.py', src);
    expect(e.raw).toEqual([
      { spec: '..core', names: ['a', 'b'] },
      { spec: '.models', names: ['Order', 'User'] },
      { spec: 'json', names: ['*'] },
      { spec: 'os', names: ['*'] },
    ]);
    expect(names('app/api.py', src)).toEqual(['const:MAX_ITEMS', 'route:GET /users/{id}', 'function:get_user', 'class:_Private(local)']);
  });

  it('Go, Rust, Java, Kotlin, Dart, Ruby, PHP, Swift, C#', () => {
    const go = 'package api\nimport (\n  "fmt"\n  m "example.com/app/models"\n)\nfunc Handle(w http.ResponseWriter) {}\nfunc (s *Server) start() {}\ntype Server struct {}\nr.GET("/health", h)';
    expect(names('api/h.go', go)).toEqual(['function:Handle', 'method:start(local)', 'class:Server', 'route:GET /health']);
    expect(extractFile('api/h.go', go).raw.map((r) => r.spec)).toEqual(['example.com/app/models', 'fmt']);

    const rs = "use crate::db::{Pool, Conn};\nmod util;\npub fn run() {}\nstruct Inner;\npub trait Store {}\nimpl X {\n    pub fn get(&self) {}\n}";
    expect(names('src/lib.rs', rs)).toEqual(['function:run', 'class:Inner(local)', 'interface:Store', 'method:get']);
    expect(extractFile('src/lib.rs', rs).raw).toEqual([
      { spec: 'crate::db', names: ['Conn', 'Pool'] },
      { spec: 'mod:util', names: ['*'] },
    ]);

    const java = 'package com.acme.web;\nimport com.acme.core.UserService;\npublic class UserController {\n    @GetMapping("/users")\n    public List<User> list() {}\n}';
    const je = extractFile('src/main/java/com/acme/web/UserController.java', java);
    expect(je.namespace).toBe('com.acme.web');
    expect(je.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(['class:UserController', 'route:GET /users', 'method:list']);

    const kt = 'package com.acme\nimport com.acme.core.Repo\ndata class User(val id: String)\nprivate fun helper() {}\n@Composable\nfun Screen() {}';
    expect(names('app/User.kt', kt)).toEqual(['class:User', 'function:helper(local)', 'component:Screen']);

    const dart = "import 'package:app/models/user.dart';\nimport '../util.dart' show fmt;\nclass Home extends StatelessWidget {}\nclass _State {}\nString greet(String n) => n;\nconst kMax = 3;";
    expect(names('lib/home.dart', dart)).toEqual(['component:Home', 'class:_State(local)', 'function:greet', 'const:kMax']);

    const rb = "require_relative 'helper'\nclass Order\n  def total\n  end\nend";
    expect(names('lib/order.rb', rb)).toEqual(['class:Order', 'method:total']);

    const php = "<?php\nnamespace App\\Http;\nuse App\\Models\\User;\nclass UserController {\n  public function index() {}\n  private function hidden() {}\n}\nRoute::get('/users', fn() => 1);";
    const pe = extractFile('app/Http/UserController.php', php);
    expect(pe.namespace).toBe('App\\Http');
    expect(pe.symbols.map((s) => `${s.kind}:${s.name}${s.exported ? '' : '(local)'}`)).toEqual(['class:UserController', 'method:index', 'method:hidden(local)', 'route:GET /users']);

    const swift = 'import SwiftUI\nstruct ContentView: View {\n    func load() {}\n}\nprivate class Cache {}';
    expect(names('App/ContentView.swift', swift)).toEqual(['component:ContentView', 'method:load', 'class:Cache(local)']);

    const cs = 'using Acme.Core;\nnamespace Acme.Web;\npublic class OrdersController {\n    [HttpGet("orders")]\n    public async Task<IActionResult> List() {}\n}';
    expect(names('Web/OrdersController.cs', cs)).toEqual(['class:OrdersController', 'route:GET orders', 'method:List']);
  });

  it('marks tests and non-code files', () => {
    expect(extractFile('src/a.test.ts', 'x').isTest).toBe(true);
    expect(extractFile('pkg/handler_test.go', 'package x').isTest).toBe(true);
    expect(extractFile('tests/test_api.py', '').isTest).toBe(true);
    expect(extractFile('docs/specs/x.md', '# x').isTest).toBe(false);
    expect(extractFile('README.md', '# x').lang).toBe('other');
  });
});

function sampleRepo(): string {
  const root = tmp();
  write(root, {
    'package.json': '{"name":"app","workspaces":["packages/*"]}',
    'tsconfig.json': '{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "@ui": ["packages/ui/src/index.ts"] } }, }',
    'packages/ui/package.json': '{"name":"@acme/ui"}',
    'packages/ui/src/index.ts': "export { Button } from './button';",
    'packages/ui/src/button.tsx': 'export function Button() { return null }',
    'src/core/db.ts': 'export function query(sql: string) { return sql }\nexport const POOL = 1;',
    'src/core/user.ts': "import { query } from './db';\nexport function getUser(id: string) { return query(id) }",
    'src/core/order.ts': "import { query } from './db.js';\nexport function getOrder() { return query('o') }",
    'src/api/routes.ts': "import { Hono } from 'hono';\nimport { getUser } from '@/core/user';\nimport { Button } from '@acme/ui';\nimport * as ui from '@ui';\nconst app = new Hono();\napp.get('/users/:id', (c) => c.json(getUser(c.req.param('id'))));",
    'src/api/auth.ts': "import { getOrder } from '../core/order';\nexport const auth = () => getOrder();",
    'src/api/util.ts': 'export const noop = () => {};',
    'test/user.test.ts': "import { getUser } from '../src/core/user';\ntest('x', () => getUser('1'));",
    'README.md': '# App',
  });
  return root;
}

describe('graph', () => {
  it('resolves relative, extension-swapped, tsconfig alias and workspace imports', () => {
    const root = sampleRepo();
    const g = buildGraph(root);
    expect(g.files['src/api/routes.ts']!.imports).toEqual(['packages/ui/src/index.ts', 'src/core/user.ts']);
    expect(g.files['src/api/routes.ts']!.external).toEqual(['hono']);
    expect(g.files['src/core/order.ts']!.imports).toEqual(['src/core/db.ts']);
    expect(g.files['test/user.test.ts']!.testsFor).toEqual(['src/core/user.ts']);
    expect(g.packages).toEqual(['', 'packages/ui']);
  });

  it('partitions into stable modules with weighted edges, surfaces and tests', () => {
    const root = sampleRepo();
    const g = buildGraph(root);
    expect(Object.keys(g.modules).sort()).toEqual(['packages-ui', 'root']);
    // Package root is a hard boundary.
    expect(g.modules['packages-ui']!.files).toEqual(['packages/ui/package.json', 'packages/ui/src/button.tsx', 'packages/ui/src/index.ts']);
    expect(g.modules['root']!.deps).toEqual({ 'packages-ui': 1 });
    expect(g.modules['packages-ui']!.surface).toEqual(['packages/ui/src/index.ts#*', 'packages/ui/src/index.ts#Button']);
  });

  it('splits big directories and keeps ids when files are added', () => {
    const files: string[] = [];
    for (let i = 0; i < 30; i++) files.push(`src/server/f${i}.ts`, `src/web/w${i}.ts`);
    files.push('src/index.ts', 'src/tiny/a.ts', 'README.md');
    const parts = partitionModules(files, []);
    // `src` keeps only 2 files of its own (fewer than MODULE_MIN), so they fold into the root.
    expect(parts.map((p) => `${p.dir}:${p.files.length}`)).toEqual([':3', 'src/server:30', 'src/web:30']);

    const g = { modules: Object.fromEntries(parts.map((p) => [p.dir.replace(/\//g, '-') || 'root', { id: p.dir.replace(/\//g, '-') || 'root', dir: p.dir, files: p.files }])) } as unknown as ContextGraph;
    // 15 more files would split `src/server` without the previous partition; with it, ids stay.
    const more = [...files, ...Array.from({ length: 15 }, (_, i) => `src/server/extra/e${i}.ts`)];
    const fresh = partitionModules(more, []).map((p) => p.dir);
    const stable = partitionModules(more, [], g.modules).map((p) => p.dir);
    expect(fresh).toEqual(['', 'src/server', 'src/server/extra', 'src/web']);
    expect(stable).toEqual(['', 'src/server', 'src/web']);
  });

  it('incremental update equals a full build', () => {
    const root = sampleRepo();
    const g1 = buildGraph(root);
    write(root, {
      'src/core/db.ts': 'export function query(sql: string, args: unknown[] = []) { return sql }',
      'src/core/cache.ts': "import { query } from './db';\nexport const cached = () => query('x');",
    });
    fs.rmSync(path.join(root, 'src/api/util.ts'));
    const inc = updateGraph(root, g1, ['src/core/db.ts', 'src/core/cache.ts', 'src/api/util.ts']);
    const full = buildGraph(root, { prev: g1 });
    expect(facts(inc)).toEqual(facts(full));
    expect(inc.files['src/api/util.ts']).toBeUndefined();
    expect(inc.files['src/core/cache.ts']!.imports).toEqual(['src/core/db.ts']);
  });
});

describe('cards', () => {
  const draft = (cite: string[]) => ({ purpose: 'Data access.', entryPoints: [{ text: 'Query entry', cite }], invariants: [], gotchas: [], howToChange: [] });

  it('validates citations: keeps symbols and in-range lines, drops the rest', () => {
    const g = buildGraph(sampleRepo());
    expect(checkCitation(g, 'src/core/db.ts#query')).toBe('src/core/db.ts#query');
    expect(checkCitation(g, 'src/core/db.ts:2')).toBe('src/core/db.ts:2');
    expect(checkCitation(g, 'src/core/db.ts:999')).toBeNull();
    expect(checkCitation(g, 'src/core/db.ts:999#query')).toBe('src/core/db.ts#query');
    expect(checkCitation(g, 'src/core/db.ts#nope')).toBeNull();
    expect(checkCitation(g, 'src/missing.ts:1')).toBeNull();
    const { draft: out, dropped } = validateCitations(
      { ...draft(['src/core/db.ts#query', 'src/ghost.ts:1']), gotchas: [{ text: 'made up', cite: ['src/ghost.ts#x'] }] },
      g,
    );
    expect(out.entryPoints).toEqual([{ text: 'Query entry', cite: ['src/core/db.ts#query'] }]);
    expect(out.gotchas).toEqual([]);
    expect(dropped).toBe(2);
  });

  it('round-trips markdown and keeps human notes verbatim', () => {
    const notes = 'Never call query() from the UI.\n\n## Not a section\n  indented `code`';
    const card = {
      id: 'src-core',
      ...draft(['src/core/db.ts#query', 'src/core/db.ts:2']),
      decisions: ['2026-10-20 · Moved to pooled connections'],
      rejected: ['Uses a global pool — it is per request'],
      humanNotes: notes,
      sources: { 'src/core/db.ts': 'abc' },
      surfaceHash: '00ff',
      generatedAt: '2026-10-20T00:00:00.000Z',
      generatedAtSha: '0123456',
    };
    const back = parseCard(renderCard(card, { dir: 'src/core' }));
    expect(back).toEqual(card);
  });

  it('detects staleness, regenerates on surface change, and keeps decisions and notes through sync', async () => {
    const root = sampleRepo();
    let calls = 0;
    const gen: CardGenerator = {
      generate: async (prompt) => {
        calls++;
        expect(prompt).toContain('Human notes');
        return JSON.stringify({ purpose: `Purpose ${calls}`, entryPoints: [{ text: 'Get a user', cite: ['src/core/user.ts#getUser', 'src/ghost.ts:1'] }] });
      },
    };
    setHumanNotes(root, 'root', 'Keep SQL in db.ts.');
    appendDecision(root, 'root', 'Chose Hono for routing', '2026-10-01');
    const s1 = await syncContext(root, { generator: gen });
    expect(s1.cardsRegenerated).toEqual(['packages-ui', 'root']);
    expect(s1.citationsDropped).toBe(2);
    const card = loadCard(root, 'root')!;
    expect(card.humanNotes).toBe('Keep SQL in db.ts.');
    expect(card.decisions).toEqual(['2026-10-01 · Chose Hono for routing']);
    expect(card.entryPoints[0]!.cite).toEqual(['src/core/user.ts#getUser']);

    // Small internal edit: hashes refresh, no regeneration.
    fs.appendFileSync(path.join(root, 'src/api/auth.ts'), '\n// tweak\n');
    const s2 = await syncContext(root, { generator: gen });
    expect(s2.cardsRegenerated).toEqual([]);
    expect(s2.cardsRefreshed).toEqual(['root']);
    expect(s2.stale).toEqual([]);

    // Surface change: a signature other modules import changes.
    const g = loadGraph(root)!;
    write(root, { 'packages/ui/src/button.tsx': 'export function Button(props: { label: string }) { return null }' });
    // `index.ts` re-exports Button; the module's surface includes `index.ts#*`, whose signature changed? No: index.ts didn't change.
    write(root, { 'packages/ui/src/index.ts': "export { Button } from './button';\nexport function Icon() { return null }" });
    const g2 = updateGraph(root, g, ['packages/ui/src/button.tsx', 'packages/ui/src/index.ts']);
    const uiCard = loadCard(root, 'packages-ui')!;
    expect(staleness(uiCard, g2.modules['packages-ui']!, g2).surfaceChanged).toBe(true);
    expect(needsRegeneration(uiCard, g2.modules['packages-ui']!, g2)).toBe(true);
    const s3 = await syncContext(root, { generator: gen });
    expect(s3.cardsRegenerated).toEqual(['packages-ui']);
    const after = loadCard(root, 'root')!;
    expect(after.humanNotes).toBe('Keep SQL in db.ts.');
  });

  it('reports stale cards when there is no generator', async () => {
    const root = sampleRepo();
    await syncContext(root, { generator: { generate: async () => '{"purpose":"x"}' } });
    // Under 30% of the module changed: the card is re-hashed, not flagged.
    fs.appendFileSync(path.join(root, 'src/core/db.ts'), '\n// a\n');
    expect((await syncContext(root, {})).cardsRefreshed).toEqual(['root']);
    // Over 30% changed and no generator to rewrite it: reported stale, and readers are warned.
    for (const f of ['src/core/db.ts', 'src/core/user.ts', 'src/core/order.ts', 'src/api/auth.ts']) fs.appendFileSync(path.join(root, f), '\n// b\n');
    const s = await syncContext(root, {});
    expect(s.stale).toEqual(['root']);
    expect(s.cardsRefreshed).toEqual([]);
    const reader = new ContextReader(root);
    expect(reader.module('root')).toMatch(/^⚠ stale since \d{4}-\d\d-\d\d: changed src\/api\/auth.ts, src\/core\/db.ts, src\/core\/order.ts, src\/core\/user.ts\. Verify/m);
  });

  it('builds a compact, token-capped prompt with symbols and numbered source', () => {
    const root = sampleRepo();
    const g = buildGraph(root);
    const prompt = buildCardPrompt(g.modules['root']!, g, (rel) => fs.readFileSync(path.join(root, rel), 'utf8'), { maxTokens: 900 });
    expect(prompt).toContain('L1 export function query(sql: string)');
    expect(prompt).toContain('1| ');
    expect(estimateTokens(prompt)).toBeLessThanOrEqual(1000);
  });
});

describe('index and queries', () => {
  it('INDEX.md stays under budget even for big repos', () => {
    const files: Record<string, string> = {};
    for (let m = 0; m < 300; m++) for (let f = 0; f < 4; f++) files[`src/area${m}/feature/file${f}.ts`] = `export function fn${m}_${f}() {}`;
    const root = tmp();
    write(root, files);
    const g = buildGraph(root);
    const purposes = Object.fromEntries(Object.keys(g.modules).map((id) => [id, 'A long purpose sentence that describes the module in some detail for readers.']));
    const text = renderIndex(g, purposes, { budget: 800 });
    expect(estimateTokens(text)).toBeLessThanOrEqual(800);
    expect(text).toContain('smaller modules');
    const small = buildGraph(sampleRepo());
    expect(renderIndex(small, { root: 'App core.' })).toContain('- root (');
  });

  it('find, deps and impact', async () => {
    const root = sampleRepo();
    await syncContext(root, {});
    const r = new ContextReader(root);
    expect(r.find('getUser').split('\n')[0]).toBe('function getUser src/core/user.ts:2 — export function getUser(id: string)');
    expect(r.find('users route')).toContain('route GET /users/:id src/api/routes.ts:6');
    expect(r.deps('src/core/db.ts', 'up', 1)).toBe(['src/core/db.ts is used by:', '  - src/core/order.ts [root]', '  - src/core/user.ts [root]'].join('\n'));
    expect(r.deps('src/api/routes.ts', 'down', 2)).toContain('    - packages/ui/src/button.tsx [packages-ui]');
    expect(r.deps('root', 'down')).toContain('- packages-ui (1)');
    const imp = r.impactSet(['src/core/db.ts']);
    expect(imp.files).toEqual(['src/api/auth.ts', 'src/api/routes.ts', 'src/core/order.ts', 'src/core/user.ts']);
    expect(imp.tests).toEqual(['test/user.test.ts']);
    expect(r.overview()).toBe(fs.readFileSync(contextPaths(root).index, 'utf8'));
    expect(r.module('src/core/db.ts')).toContain('No card yet');
  });
});
