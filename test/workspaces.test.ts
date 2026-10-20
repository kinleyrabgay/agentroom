import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Project } from '../src/core/project.js';
import { slugify } from '../src/core/slug.js';
import { buildGraph, readIndexable } from '../src/core/context/index.js';
import {
  addRepos,
  clientSegments,
  createWorkspace,
  deleteWorkspace,
  graphqlFields,
  graphqlOperations,
  inferCrossRepoEdges,
  listWorkspaces,
  loadWorkspace,
  matchScore,
  pathLiterals,
  prepareMember,
  ProjectRegistry,
  removeRepo,
  routeSegments,
  setPrimary,
  specPaths,
  trpcCalls,
  trpcKeys,
} from '../src/core/workspaces/index.js';
import { GoalStatus, HostTool, TaskKind, TaskStatus } from '../src/shared/enums.js';
import { PermissionGate } from '../src/server/agents/permission-gate.js';
import { SessionStore } from '../src/server/agents/session-store.js';
import { Team } from '../src/server/agents/team.js';
import { checkTaskRepo } from '../src/server/agents/tools/task.tools.js';
import { ContextService } from '../src/server/context/context.service.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import type { Provider, RunRequest, RunResult } from '../src/server/providers/provider.js';
import { Hub } from '../src/server/realtime/hub.js';
import { GoalRepos, linkedPrSection, LINKS_START, withLinkedSection } from '../src/server/workspaces/goal-repos.js';
import { WorkspaceService } from '../src/server/workspaces/workspace.service.js';
import { NotificationService } from '../src/server/services/notification.service.js';
import { GoalRunner } from '../src/server/workflow/goal-runner.js';
import { SecurityService } from '../src/server/security/security.service.js';
import { FindingsStore } from '../src/server/security/findings.store.js';
import { CliGitReader } from '../src/server/security/git.js';
import { DependencyGuard } from '../src/server/security/dependency/dependency-guard.js';

const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function gitRepo(prefix: string, files: Record<string, string>) {
  const root = tmp(prefix);
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 'test@example.com');
  sh(root, 'config', 'user.name', 'Test');
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', 'init');
  return root;
}

// Workspaces live in $AGENTROOM_HOME/workspaces; goal worktrees in $HOME/.agentroom/worktrees. Keep both in temp.
const saved = { home: process.env.HOME, arHome: process.env.AGENTROOM_HOME };
beforeAll(() => {
  const home = tmp('agentroom-home-');
  process.env.HOME = home;
  process.env.AGENTROOM_HOME = path.join(home, '.agentroom');
});
afterAll(() => {
  process.env.HOME = saved.home;
  if (saved.arHome === undefined) delete process.env.AGENTROOM_HOME;
  else process.env.AGENTROOM_HOME = saved.arHome;
});

describe('workspace config', () => {
  it('creates, adds, removes and lists workspaces with stable unique ids', () => {
    // Only git checkouts can join (a `.git` folder is enough here).
    const repo = (dir: string) => (fs.mkdirSync(path.join(dir, '.git'), { recursive: true }), dir);
    const a = repo(tmp('web-'));
    const b = repo(tmp('api-'));
    const twin = path.join(tmp('x-'), path.basename(a));
    repo(twin);
    expect(() => createWorkspace('plain', [tmp('plain-')])).toThrow(/isn't a git repo/);
    const workspace = createWorkspace('shop', [a, b]);
    expect(workspace.repos.map((r) => r.id)).toEqual([slugify(path.basename(a)), slugify(path.basename(b))]);
    expect(workspace.primary).toBe(workspace.repos[0]!.id);
    // Same folder name elsewhere gets a suffixed id.
    const more = addRepos('shop', [twin]);
    expect(more.repos[2]!.id).toBe(`${workspace.repos[0]!.id}-2`);
    expect(() => addRepos('shop', [a])).toThrow(/already in the workspace/);
    // Nested repos would be indexed twice.
    const inner = path.join(a, 'packages', 'inner');
    repo(inner);
    expect(() => addRepos('shop', [inner])).toThrow(/nested/);
    expect(() => createWorkspace('shop', [a])).toThrow(/already exists/);
    expect(() => createWorkspace('Bad Name', [a])).toThrow(/lowercase/);
    expect(() => createWorkspace('nope', [path.join(a, 'missing')])).toThrow(/No such folder/);

    // Removing the primary repo hands the board to the next one.
    const afterRemove = removeRepo('shop', workspace.repos[0]!.id);
    expect(afterRemove.primary).toBe(workspace.repos[1]!.id);
    expect(setPrimary('shop', twin).primary).toBe(more.repos[2]!.id);
    expect(listWorkspaces().map((r) => r.name)).toContain('shop');
    expect(loadWorkspace('shop').repos).toHaveLength(2);
    expect(() => removeRepo('shop', 'missing')).toThrow(/isn't in workspace/);
    deleteWorkspace('shop');
    expect(() => loadWorkspace('shop')).toThrow(/No workspace "shop"/);
  });

  it('prepares other repos without scaffolding a team (gitignored runs/)', () => {
    const repo = gitRepo('member-', { 'a.ts': 'export const a = 1;\n' });
    expect(prepareMember(repo, () => false)).toBe(true);
    expect(fs.existsSync(path.join(repo, '.agentroom', 'runs'))).toBe(true);
    expect(fs.existsSync(path.join(repo, '.agentroom', 'bots'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toContain('.agentroom/runs/');
    expect(prepareMember(repo, () => false)).toBe(false);
    const priv = gitRepo('member-priv-', { 'a.ts': '' });
    prepareMember(priv, () => true);
    expect(fs.existsSync(path.join(priv, '.gitignore'))).toBe(false);
  });

  it('the registry resolves repos, normalises the primary to unset and rejects unknown ids', () => {
    const web = tmp('reg-web-');
    const api = tmp('reg-api-');
    const project = new Project(web);
    const single = ProjectRegistry.single(project);
    expect(single.isWorkspace).toBe(false);
    expect(single.view()).toBeNull();
    expect(single.normalize(undefined)).toBeUndefined();

    const reg = ProjectRegistry.fromWorkspace({ name: 'r', repos: [{ id: 'web', path: web }, { id: 'api', path: api }], primary: 'web', createdAt: '' }, project);
    expect(reg.isWorkspace).toBe(true);
    expect(reg.primaryId).toBe('web');
    expect(reg.normalize('web')).toBeUndefined();
    expect(reg.normalize('api')).toBe('api');
    expect(() => reg.normalize('nope')).toThrow(/Unknown repo "nope"/);
    expect(reg.root('api')).toBe(api);
    expect(reg.repoOfPath(path.join(api, 'src', 'x.ts'))?.id).toBe('api');
    expect(reg.project('api').root).toBe(api);
    expect(reg.view()!.repos.map((r) => [r.id, r.primary])).toEqual([
      ['web', true],
      ['api', false],
    ]);
    expect(() => ProjectRegistry.fromWorkspace({ name: 'r', repos: [{ id: 'api', path: api }], createdAt: '' }, project)).toThrow(/primary repo is/);
  });

  it('task repos are checked against the workspace', () => {
    const deps = { repos: ['web', 'api'], primaryRepo: 'web' };
    expect(checkTaskRepo('api', deps)).toBe('api');
    expect(checkTaskRepo('web', deps)).toBeNull();
    expect(checkTaskRepo(undefined, deps)).toBeUndefined();
    expect(() => checkTaskRepo('ios', deps)).toThrow(/Unknown repo "ios"/);
    // Outside a workspace the field is ignored.
    expect(checkTaskRepo('api', {})).toBeUndefined();
  });
});

describe('cross-repo edges', () => {
  it('matches paths, specs and contracts', () => {
    expect(routeSegments('/users/:id')).toEqual(['users', ':']);
    expect(routeSegments('/api/users/[id]')).toEqual(['api', 'users', ':']);
    expect(routeSegments('/orders/{orderId}/items')).toEqual(['orders', ':', 'items']);
    expect(clientSegments('/api/users/${user.id}')).toEqual(['api', 'users', ':']);
    expect(clientSegments('https://api.example.com/v1/orders?x=1')).toEqual(['v1', 'orders']);
    expect(clientSegments('/logo.svg')).toBeNull();
    expect(clientSegments('//cdn.example.com/x')).toBeNull();
    expect(matchScore(['api', 'users', ':'], ['users', ':'])).toBeGreaterThan(0);
    expect(matchScore(['users', ':'], ['users', ':'])).toBe(1);
    expect(matchScore(['users'], ['users', ':'])).toBe(0);
    expect(matchScore(['x', ':'], [':', ':'])).toBe(0);
    expect(matchScore(['orders', ':'], ['users', ':'])).toBe(0);
    expect(specPaths('openapi: 3.0.0\npaths:\n  /pets:\n    get: {}\n  "/pets/{id}":\n    get: {}\ncomponents: {}\n', false)).toEqual(['/pets', '/pets/{id}']);
    expect(specPaths(JSON.stringify({ paths: { '/a': {}, '/b/{x}': {} } }), true)).toEqual(['/a', '/b/{x}']);
    expect(graphqlFields('type Query {\n  product(id: ID!): Product\n  products: [Product]\n}\nextend type Mutation { addToCart(id: ID!): Cart }')).toEqual(['product', 'products', 'addToCart']);
    expect(graphqlOperations('gql`query Product($id: ID!) { product(id: $id) { name } }`').map((o) => o.field)).toEqual(['product']);
    expect(trpcKeys("export const appRouter = router({ users: usersRouter, health: publicProcedure.query(() => 'ok') })")).toEqual(['users', 'health']);
    expect(trpcCalls('trpc.users.byId.useQuery({ id })').map((c) => c.keys)).toEqual([['users', 'byId']]);
    // Import specifiers are never treated as API paths.
    expect(pathLiterals("import x from '/abs/module';\nconst u = `/api/users/${id}`;").map((l) => l.value)).toEqual(['/api/users/${id}']);
  });

  it('infers edges between a frontend and a backend from real fact graphs', () => {
    const api = tmp('api-');
    write(api, 'package.json', JSON.stringify({ name: '@shop/api' }));
    write(api, 'src/server.ts', "import { Hono } from 'hono';\nconst app = new Hono();\napp.get('/users/:id', (c) => c.json({}));\napp.post('/orders', (c) => c.json({}));\nexport default app;\n");
    write(api, 'src/schema.graphql', 'type Query {\n  product(id: ID!): Product\n}\n');
    write(api, 'openapi.yaml', 'openapi: 3.0.0\npaths:\n  /carts/{id}:\n    get: {}\n');
    write(api, 'src/trpc/router.ts', "import { router, publicProcedure } from './t';\nexport const appRouter = router({ users: usersRouter, byId: publicProcedure.query(() => 1) });\n");
    write(api, 'shared/package.json', JSON.stringify({ name: '@shop/types' }));
    write(api, 'shared/index.ts', 'export type User = { id: string };\n');

    const web = tmp('web-');
    write(web, 'package.json', JSON.stringify({ name: 'web', dependencies: { '@shop/types': '1.0.0' } }));
    write(web, 'src/lib/api.ts', "export const getUser = (id: string) => fetch(`/api/users/${id}`);\nexport const order = () => fetch('/api/orders', { method: 'POST' });\nexport const cart = (id: string) => fetch(`${BASE}/carts/${id}`);\n");
    write(web, 'src/lib/gql.ts', 'import { gql } from "graphql-tag";\nexport const Q = gql`query P($id: ID!) { product(id: $id) { name } }`;\n');
    write(web, 'src/lib/trpc.ts', 'import { trpc } from "./client";\nexport const u = () => trpc.users.byId.useQuery({ id: 1 });\n');
    write(web, 'src/lib/types.ts', "import type { User } from '@shop/types';\nexport type U = User;\n");
    write(web, 'src/assets.ts', "export const logo = '/logo.svg';\n");

    const inputs = [
      { repo: 'web', graph: buildGraph(web), read: (rel: string) => readIndexable(web, rel) },
      { repo: 'api', graph: buildGraph(api), read: (rel: string) => readIndexable(api, rel) },
    ];
    const edges = inferCrossRepoEdges(inputs);
    const kinds = new Set(edges.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(['graphql', 'http', 'openapi', 'package', 'trpc']);
    for (const e of edges) {
      expect(e.fromRepo).toBe('web');
      expect(e.toRepo).toBe('api');
      expect(e.evidence.length).toBeGreaterThan(0);
    }
    const http = edges.find((e) => e.kind === 'http')!;
    expect(http.weight).toBe(2);
    expect(http.evidence.map((v) => v.detail).join('\n')).toContain('/api/users/${id} → GET /users/:id');
    expect(edges.find((e) => e.kind === 'openapi')!.evidence[0]!.detail).toContain('/carts/{id}');
    // One repo, or none: no edges.
    expect(inferCrossRepoEdges([inputs[0]!])).toEqual([]);
  });

  it('the workspace service merges each repo map with the edges between them', () => {
    const web = tmp('rs-web-');
    write(web, 'src/api.ts', "export const getUser = (id: string) => fetch(`/api/users/${id}`);\n");
    const api = tmp('rs-api-');
    write(api, 'src/server.ts', "import { Hono } from 'hono';\nconst app = new Hono();\napp.get('/users/:id', (c) => c.json({}));\n");
    const project = new Project(web);
    project.init();
    const registry = ProjectRegistry.fromWorkspace({ name: 'r', repos: [{ id: 'web', path: web }, { id: 'api', path: api }], primary: 'web', createdAt: '' }, project);
    const make = (root: string) => new ContextService({ root, settings: () => project.settings.get() });
    const workspace = new WorkspaceService({ registry, primaryContext: make(web), makeContext: (r) => make(r.root) });
    // Not mapped yet: repos show as unbuilt, no edges.
    expect(workspace.graph().repos.map((r) => r.built)).toEqual([false, false]);
    for (const root of [web, api]) {
      const g = buildGraph(root);
      fs.mkdirSync(path.join(root, '.agentroom', 'runs', 'context'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agentroom', 'runs', 'context', 'graph.json'), JSON.stringify(g));
    }
    const view = workspace.graph();
    expect(view.repos.every((r) => r.built && r.modules.length > 0)).toBe(true);
    expect(view.crossEdges).toHaveLength(1);
    expect(view.crossEdges[0]).toMatchObject({ fromRepo: 'web', toRepo: 'api', kind: 'http' });
    expect(workspace.promptBlock()).toContain('Workspace "r": 2 repos');
    expect(workspace.promptBlock()).toContain('web:');
    expect(workspace.context('api')).toBe(workspace.context('api'));
    expect(() => workspace.context('ios')).toThrow(/Unknown repo/);
  });

  it('people confirm, hide and add cross-repo links; bots see confirmed ones first', () => {
    const web = tmp('lk-web-');
    write(web, 'src/api.ts', "export const getUser = (id: string) => fetch(`/api/users/${id}`);\n");
    write(web, 'src/ui/page.ts', 'export const page = 1;\n');
    const api = tmp('lk-api-');
    write(api, 'src/server.ts', "import { Hono } from 'hono';\nconst app = new Hono();\napp.get('/users/:id', (c) => c.json({}));\n");
    write(api, 'lib/db.ts', 'export const db = 1;\n');
    const project = new Project(web);
    project.init();
    const registry = ProjectRegistry.fromWorkspace({ name: 'lk', repos: [{ id: 'web', path: web }, { id: 'api', path: api }], primary: 'web', createdAt: '' }, project);
    const make = (root: string) => new ContextService({ root, settings: () => project.settings.get() });
    const workspace = new WorkspaceService({ registry, primaryContext: make(web), makeContext: (r) => make(r.root) });
    for (const root of [web, api]) {
      fs.mkdirSync(path.join(root, '.agentroom', 'runs', 'context'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agentroom', 'runs', 'context', 'graph.json'), JSON.stringify(buildGraph(root)));
    }
    const [guess] = workspace.crossEdges();
    expect(guess).toMatchObject({ status: 'guessed', kind: 'http' });
    expect(workspace.promptBlock()).toContain('(guessed, http');

    workspace.decideLink(guess!.key!, 'confirm');
    expect(workspace.crossEdges()[0]!.status).toBe('confirmed');
    expect(workspace.promptBlock()).toContain('(confirmed, http');
    // Committed in the primary repo, so the team shares it.
    const file = path.join(web, '.agentroom', 'context', 'workspace-links.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).confirmed).toEqual([guess!.key]);

    workspace.decideLink(guess!.key!, 'hide');
    expect(workspace.crossEdges()).toEqual([]);
    expect(workspace.crossEdges({ hidden: true })[0]).toMatchObject({ hidden: true });
    workspace.decideLink(guess!.key!, 'reset');
    expect(workspace.crossEdges()[0]!.status).toBe('guessed');

    const mods = (id: string) => Object.keys(workspace.context(id).reader.current()!.modules);
    const from = mods('web')[0]!;
    const to = mods('api')[0]!;
    expect(() => workspace.addLink({ fromRepo: 'web', from, toRepo: 'web', to: from })).toThrow(/two different repos/);
    expect(() => workspace.addLink({ fromRepo: 'web', from: 'nope', toRepo: 'api', to })).toThrow(/No module/);
    workspace.addLink({ fromRepo: 'web', from, toRepo: 'api', to, note: 'reads the db through a proxy' }, 'Kinley');
    const manual = workspace.crossEdges()[0]!;
    expect(manual).toMatchObject({ kind: 'manual', status: 'manual', note: 'reads the db through a proxy' });
    expect(workspace.promptBlock()).toContain('reads the db through a proxy');
    expect(() => workspace.addLink({ fromRepo: 'web', from, toRepo: 'api', to })).toThrow(/already there/);
    workspace.removeLink(manual.key!);
    expect(workspace.crossEdges().some((e) => e.kind === 'manual')).toBe(false);
  });
});

describe('workspace routes', () => {
  it('context requests pick their repo from the header, tasks only take workspace repos', async () => {
    const web = tmp('rt-web-');
    write(web, 'src/web.ts', 'export const web = 1;\n');
    const api = tmp('rt-api-');
    write(api, 'src/server.ts', "import { Hono } from 'hono';\nconst app = new Hono();\napp.get('/users/:id', (c) => c.json({}));\n");
    const project = new Project(web);
    project.init();
    const registry = ProjectRegistry.fromWorkspace({ name: 'r', repos: [{ id: 'web', path: web }, { id: 'api', path: api }], primary: 'web', createdAt: '' }, project);
    const make = (root: string) => new ContextService({ root, settings: () => project.settings.get() });
    const workspace = new WorkspaceService({ registry, primaryContext: make(web), makeContext: (r) => make(r.root) });
    for (const root of [web, api]) {
      fs.mkdirSync(path.join(root, '.agentroom', 'runs', 'context'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agentroom', 'runs', 'context', 'graph.json'), JSON.stringify(buildGraph(root)));
    }
    const { Hono } = await import('hono');
    const { contextRoutes } = await import('../src/server/http/routes/context.routes.js');
    const { workspaceRoutes } = await import('../src/server/http/routes/workspace.routes.js');
    const { taskRoutes } = await import('../src/server/http/routes/tasks.routes.js');
    const { REPO_HEADER } = await import('../src/shared/constants.js');
    const app = new Hono();
    const audit = () => {};
    contextRoutes(app, (repo) => workspace.context(repo), audit);
    workspaceRoutes(app, workspace, audit);
    taskRoutes(app, project, () => {}, (repo) => registry.normalize(repo) ?? null);

    const files = async (headers: Record<string, string> = {}) => (await (await app.request('/context/files', { headers })).json()) as string[];
    expect(await files()).toContain('src/web.ts');
    expect(await files()).not.toContain('src/server.ts');
    expect(await files({ [REPO_HEADER]: 'api' })).toEqual(['src/server.ts']);
    expect((await app.request('/context/files', { headers: { [REPO_HEADER]: 'ios' } })).status).toBeGreaterThanOrEqual(400);
    // A peek can't cross into another repo: the path must be indexed in the repo asked for.
    expect((await app.request('/context/file?path=src/server.ts')).status).toBeGreaterThanOrEqual(400);
    expect((await app.request(`/context/file?path=src/server.ts&repo=api`)).status).toBe(200);

    const view = (await (await app.request('/workspace')).json()) as { name: string; repos: { id: string }[] };
    expect(view.repos.map((r) => r.id)).toEqual(['web', 'api']);
    const graph = (await (await app.request('/workspace/graph')).json()) as { repos: unknown[]; crossEdges: unknown[] };
    expect(graph.repos).toHaveLength(2);

    const post = (body: unknown) => app.request('/tasks', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const created = (await (await post({ title: 'API work', repo: 'api' })).json()) as { id: string; repo?: string };
    expect(created.repo).toBe('api');
    const primary = (await (await post({ title: 'Web work', repo: 'web' })).json()) as { repo?: string };
    expect(primary.repo).toBeUndefined();
    expect((await post({ title: 'iOS', repo: 'ios' })).status).toBeGreaterThanOrEqual(400);
    const moved = await app.request(`/tasks/${created.id}`, { method: 'PATCH', body: JSON.stringify({ repo: null }), headers: { 'content-type': 'application/json' } });
    expect(((await moved.json()) as { repo?: string }).repo).toBeUndefined();
  });
});

describe('linked PRs', () => {
  it('builds and replaces the "part n of m" block', () => {
    const parts = [
      { repo: 'web', name: 'web', url: 'https://github.com/o/web/pull/3' },
      { repo: 'api', name: 'api' },
    ];
    const section = linkedPrSection('G-1', parts, 'api');
    expect(section).toContain('**Part 2 of 2**');
    expect(section).toContain('`web`: https://github.com/o/web/pull/3');
    expect(section).toContain('`api`: this PR');
    const body = withLinkedSection('## Summary\nx', section);
    expect(body.startsWith(LINKS_START)).toBe(true);
    const updated = withLinkedSection(body, linkedPrSection('G-1', [parts[0]!, { ...parts[1]!, url: 'https://github.com/o/api/pull/9' }], 'web'));
    expect(updated.split(LINKS_START)).toHaveLength(2);
    expect(updated).toContain('`api`: https://github.com/o/api/pull/9');
    expect(updated).toContain('## Summary\nx');
  });
});

// ── a goal across two repos, with a fake provider and real git ─────────────

type Script = (req: RunRequest, call: (tool: string, args: Record<string, unknown>) => Promise<string>) => Promise<string>;

class FakeProvider implements Provider {
  readonly id = 'fake';
  readonly runs: { role: string; cwd: string; extra: string[]; prompt: string }[] = [];
  constructor(private readonly scripts: Record<string, Script>) {}
  async run(req: RunRequest): Promise<RunResult> {
    this.runs.push({ role: req.bot.role, cwd: req.cwd, extra: req.additionalDirectories ?? [], prompt: req.prompt });
    const call = (name: string, args: Record<string, unknown>) => {
      const tool = req.hostTools.find((t) => t.name === name);
      if (!tool) throw new Error(`${req.bot.id} has no tool ${name}`);
      return tool.handler(args);
    };
    return { ok: true, result: await (this.scripts[req.bot.role] ?? (async () => 'ok'))(req, call) };
  }
  async listModels() {
    return [];
  }
}

const waitFor = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const goalIdOf = (prompt: string) => /goal (G-\d+)/.exec(prompt)![1]!;
const taskIdOf = (prompt: string) => /^# (?:Build|QA) (T-\d+)/m.exec(prompt)![1]!;

describe('a goal across repos', () => {
  it('routes each task to its repo, with a branch, checkpoints and a linked PR draft per repo', async () => {
    const web = gitRepo('goal-web-', { 'src/app.ts': 'export const app = 1;\n' });
    const api = gitRepo('goal-api-', { 'src/server.ts': 'export const server = 1;\n' });
    const project = new Project(web);
    project.init();
    project.config.update({ permissionMode: 'auto' });
    sh(web, 'add', '-A');
    sh(web, 'commit', '-q', '-m', 'agentroom');
    const registry = ProjectRegistry.fromWorkspace({ name: 'shop', repos: [{ id: 'web', path: web }, { id: 'api', path: api }], primary: 'web', createdAt: '' }, project);
    const ctx = (root: string) => new ContextService({ root, settings: () => project.settings.get() });
    const workspace = new WorkspaceService({ registry, primaryContext: ctx(web), makeContext: (r) => ctx(r.root) });
    const hub = new Hub(project.paths.runs);
    const notifications = new NotificationService(hub, project.paths.inboxFile);
    const boardChanged = () => {};
    let badRepo = '';
    const provider = new FakeProvider({
      planner: async (req, call) => {
        const goalId = goalIdOf(req.prompt);
        try {
          await call(HostTool.TaskCreate, { title: 'iOS work', goalId, repo: 'ios' });
        } catch (e) {
          badRepo = (e as Error).message;
        }
        const apiTask = JSON.parse(await call(HostTool.TaskCreate, { title: 'Add /users endpoint', kind: TaskKind.Dev, goalId, assignee: 'developer', repo: 'api' }));
        const webTask = JSON.parse(await call(HostTool.TaskCreate, { title: 'Call /users from the app', kind: TaskKind.Dev, goalId, assignee: 'developer', dependsOn: [apiTask.id] }));
        await call(HostTool.TaskCreate, { title: 'Verify users', kind: TaskKind.QA, goalId, assignee: 'qa', dependsOn: [webTask.id] });
        return 'Planned.';
      },
      developer: async (req, call) => {
        const id = taskIdOf(req.prompt);
        fs.writeFileSync(path.join(req.cwd, `${id}.ts`), `export const done = '${id}';\n`);
        await call(HostTool.TaskUpdate, { id, status: TaskStatus.Review });
        return 'Done.';
      },
      qa: async (req, call) => {
        await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Done });
        return 'Passed.';
      },
      lead: async () => 'All good.',
    });
    const team = new Team({
      project,
      hub,
      provider,
      previews: new PreviewService(hub),
      permissions: new PermissionGate(hub, () => project.config.get(), web),
      sessions: new SessionStore(project.paths.sessionsFile),
      notifications,
      boardChanged,
      workspace,
    });
    const repos = new GoalRepos({ registry, update: (id, r) => project.goals.update(id, { repos: r }), worktreesEnabled: () => true });
    const done: string[] = [];
    const runner = new GoalRunner({ project, team, hub, notifications, boardChanged, repos, onRepoDone: (repo, _g, files) => done.push(`${repo}:${files.join(',')}`) });

    const goal = runner.start('Show users from the API in the app');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    expect(badRepo).toMatch(/Unknown repo "ios"/);
    const planRun = provider.runs.find((r) => r.role === 'planner')!;
    expect(planRun.prompt).toContain('This goal can span 2 repos');
    // Planning reads the other repo where it is.
    expect(planRun.extra).toEqual([api]);

    runner.approve(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Done);
    const final = project.goals.get(goal.id)!;
    const apiPart = final.repos?.api;
    expect(apiPart?.worktree?.branch).toBe('agentroom/g-1');
    expect(apiPart?.baseRef).toBeTruthy();
    expect(final.worktree?.branch).toBe('agentroom/g-1');

    const tasks = project.tasks.list({ goalId: goal.id });
    const apiTask = tasks.find((t) => t.repo === 'api')!;
    const webTask = tasks.find((t) => t.kind === TaskKind.Dev && !t.repo)!;
    // Each dev task ran in its own repo's goal folder, with the other repo's goal folder as an extra.
    const devRuns = provider.runs.filter((r) => r.role === 'developer');
    expect(devRuns[0]!.cwd).toBe(apiPart!.worktree!.path);
    expect(devRuns[0]!.extra).toEqual([final.worktree!.path]);
    expect(devRuns[0]!.prompt).toContain('Repo for');
    expect(devRuns[1]!.cwd).toBe(final.worktree!.path);
    expect(devRuns[1]!.extra).toEqual([apiPart!.worktree!.path]);
    // The human's working copies are untouched; the work is on the goal branches.
    expect(fs.existsSync(path.join(api, `${apiTask.id}.ts`))).toBe(false);
    expect(apiTask.commits).toHaveLength(1);
    expect(sh(apiPart!.worktree!.path, 'log', '-1', '--format=%s')).toBe(`${apiTask.id}: Add /users endpoint`);
    expect(webTask.commits).toHaveLength(1);

    // Changes per repo.
    const apiChanges = await runner.changes(goal.id, 'api');
    expect(apiChanges.repo).toBe('api');
    expect(apiChanges.files.map((f) => f.path)).toEqual([`${apiTask.id}.ts`]);
    expect(apiChanges.groups.map((g) => g.taskId)).toEqual([apiTask.id]);
    const webChanges = await runner.changes(goal.id);
    expect(webChanges.files.map((f) => f.path)).toEqual([`${webTask.id}.ts`]);
    expect(webChanges.groups.map((g) => g.taskId)).toEqual([webTask.id]);
    await waitFor(() => done.length === 1);
    expect(done).toEqual([`api:${apiTask.id}.ts`]);

    // PR drafts per repo, each with the linked block and only its own tasks.
    const apiDraft = await runner.prDraft(goal.id, 'api');
    expect(apiDraft.repo).toBe('api');
    expect(apiDraft.title).toContain('(');
    expect(apiDraft.body).toContain('**Part 2 of 2**');
    expect(apiDraft.body).toContain(apiTask.title);
    expect(apiDraft.body).not.toContain(webTask.title);
    const webDraft = await runner.prDraft(goal.id);
    expect(webDraft.body).toContain('**Part 1 of 2**');

    // Cleanup removes both folders, branches stay.
    await runner.cleanup(goal.id);
    expect(fs.existsSync(apiPart!.worktree!.path)).toBe(false);
    expect(sh(api, 'branch', '--list', 'agentroom/g-1')).toContain('agentroom/g-1');

    // Review comments remember their repo; Request changes makes one fix task per repo.
    expect(() => runner.addComment(goal.id, { file: 'src/server.ts', body: 'x', repo: 'ios' }, 'K')).toThrow(/Unknown repo/);
    const withComments = runner.addComment(goal.id, { file: 'src/server.ts', line: 1, body: 'Validate the id', repo: 'api' }, 'K');
    expect(withComments.reviewComments.at(-1)!.repo).toBe('api');
    expect(runner.addComment(goal.id, { file: 'src/app.ts', body: 'Show a spinner', repo: 'web' }, 'K').reviewComments.at(-1)!.repo).toBeUndefined();
    const before = new Set(project.tasks.list({ goalId: goal.id }).map((t) => t.id));
    runner.requestChanges(goal.id);
    runner.cancel(goal.id);
    const fixes = project.tasks.list({ goalId: goal.id }).filter((t) => !before.has(t.id));
    expect(fixes.map((t) => [t.title, t.repo]).sort()).toEqual([
      ['Review changes (1 comment)', undefined],
      [`Review changes in ${path.basename(api)} (1 comment)`, 'api'],
    ]);
  }, 30_000);
});

describe('security across repos', () => {
  it('a risky change in another repo triggers the security review and blocks that repo’s PR', async () => {
    const web = gitRepo('sec-web-', { 'src/app.ts': 'export const app = 1;\n' });
    const api = gitRepo('sec-api-', { 'src/server.ts': 'export const server = 1;\n' });
    const project = new Project(web);
    project.init();
    project.config.update({ permissionMode: 'auto' });
    sh(web, 'add', '-A');
    sh(web, 'commit', '-q', '-m', 'agentroom');
    const registry = ProjectRegistry.fromWorkspace({ name: 'shop', repos: [{ id: 'web', path: web }, { id: 'api', path: api }], primary: 'web', createdAt: '' }, project);
    const hub = new Hub(project.paths.runs);
    const notifications = new NotificationService(hub, project.paths.inboxFile);
    const boardChanged = () => {};
    const repos = new GoalRepos({ registry, update: (id, r) => project.goals.update(id, { repos: r }), worktreesEnabled: () => true });
    const security = new SecurityService({
      git: new CliGitReader(web),
      guard: new DependencyGuard({ cwd: web, run: async () => ({ stdout: '' }), fetch: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }) }),
      findings: new FindingsStore({ file: path.join(project.paths.runs, 'security.json') }),
      settings: () => project.settings.get(),
      notifications,
      goalBase: (id) => project.goals.get(id)?.baseRef,
      goalCwd: (id) => project.goals.get(id)?.worktree?.path,
      gitFor: (cwd) => new CliGitReader(cwd),
      goalRepos: (id) => {
        const goal = project.goals.get(id)!;
        return Object.entries(goal.repos ?? {}).map(([repo, st]) => ({ repo, cwd: repos.cwd(goal, repo), ...(st.baseRef ? { base: st.baseRef } : {}) }));
      },
    });
    let auditorPrompt = '';
    const provider = new FakeProvider({
      planner: async (req, call) => {
        const goalId = goalIdOf(req.prompt);
        const apiTask = JSON.parse(await call(HostTool.TaskCreate, { title: 'Add the token endpoint', kind: TaskKind.Dev, goalId, assignee: 'developer', repo: 'api' }));
        await call(HostTool.TaskCreate, { title: 'Verify', kind: TaskKind.QA, goalId, assignee: 'qa', dependsOn: [apiTask.id] });
        return 'Planned.';
      },
      developer: async (req, call) => {
        // Only the other repo changes, under a sensitive path, with a leaked key.
        fs.mkdirSync(path.join(req.cwd, 'src', 'auth'), { recursive: true });
        fs.writeFileSync(path.join(req.cwd, 'src', 'auth', 'keys.ts'), `export const key = 'AKIAZ7Q3X9K2M4N6P8R1';\n`);
        await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Review });
        return 'Done.';
      },
      security: async (req) => {
        auditorPrompt = req.prompt;
        return 'Must fix: leaked key.';
      },
      qa: async (req, call) => {
        await call(HostTool.TaskUpdate, { id: taskIdOf(req.prompt), status: TaskStatus.Done });
        return 'Passed.';
      },
      lead: async () => 'Report.',
    });
    const team = new Team({
      project,
      hub,
      provider,
      previews: new PreviewService(hub),
      permissions: new PermissionGate(hub, () => project.config.get(), web),
      sessions: new SessionStore(project.paths.sessionsFile),
      notifications,
      boardChanged,
      security,
      workspace: new WorkspaceService({ registry, primaryContext: new ContextService({ root: web, settings: () => project.settings.get() }), makeContext: (r) => new ContextService({ root: r.root, settings: () => project.settings.get() }) }),
    });
    const runner = new GoalRunner({ project, team, hub, notifications, boardChanged, repos, security });

    const goal = runner.start('Add a token endpoint');
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.AwaitingApproval);
    runner.approve(goal.id);
    await waitFor(() => project.goals.get(goal.id)!.status === GoalStatus.Paused, 15_000);

    const final = project.goals.get(goal.id)!;
    // The primary repo didn't change, yet the goal was scored on the other repo's diff.
    expect(final.risk?.factors.some((f) => f.label.includes('api/src/auth/keys.ts'))).toBe(true);
    expect(final.securityReviewedRound).toBe(final.round);
    expect(auditorPrompt).toContain('Other repos in this change');
    expect(final.reason).toMatch(/critical/);
    const leaked = security.findings.list({ goalId: goal.id }).find((f) => f.rule === 'secret.aws-access-key')!;
    expect(leaked.repo).toBe('api');
    expect(security.findings.openBlocking(goal.id, 'critical', '')).toHaveLength(0);
    expect(security.findings.openBlocking(goal.id, 'critical', 'api').length).toBeGreaterThan(0);

    // The api repo's PR is held until the finding is resolved.
    await expect(runner.openPr(goal.id, { repo: 'api' })).rejects.toThrow(/blocks? this pull request/);

    // A bot pushing from the goal's api folder is held too.
    const hold = await security.gate('git push origin agentroom/g-1', { goalId: goal.id });
    expect(hold?.reason).toMatch(/repo api/);
  }, 30_000);
});
