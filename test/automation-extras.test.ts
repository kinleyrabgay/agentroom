import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ProjectPaths } from '../src/core/paths.js';
import { MemoryRepository, parseMemory, formatMemory, MEMORY_CONTEXT_LIMIT } from '../src/core/repositories/memory.repository.js';
import { GoalTemplateRepository, composeBrief, parseTemplate } from '../src/core/repositories/goal-template.repository.js';
import { templatesDir } from '../src/core/fs/templates.js';
import { buildContext } from '../src/server/agents/context-builder.js';
import { RemoteService } from '../src/server/remote/remote.service.js';
import { remotePublicRoutes, tunnelGuard, REMOTE_TOKEN_HEADER } from '../src/server/http/routes/remote.routes.js';
import { requireToken } from '../src/server/http/auth.js';
import { GoalStatus, NotificationKind } from '../src/shared/enums.js';
import type { Bot } from '../src/shared/types/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-extras-'));
const bot = { id: 'developer', name: 'Developer', role: 'developer', dir: '03-developer', order: 3, prompt: '', skills: [], tools: [], localSkills: [] } as unknown as Bot;

describe('bot memory', () => {
  it('round-trips memory.md with pinned notes', () => {
    const md = formatMemory('Developer', [{ text: 'Use yarn', pinned: true }, { text: 'Tests live in libs/**', pinned: false }]);
    expect(parseMemory(md)).toEqual([{ text: 'Use yarn', pinned: true }, { text: 'Tests live in libs/**', pinned: false }]);
  });

  it('keeps or ignores suggestions; only kept ones reach memory.md and the context', () => {
    const repo = new MemoryRepository(new ProjectPaths(tmp()));
    const a = repo.suggest('developer', 'Run yarn nx test opportunity, not the whole suite', 'slow suite');
    const b = repo.suggest('developer', 'Some one-off detail');
    expect(repo.suggest('developer', 'run yarn nx test opportunity, not the whole suite').id).toBe(a.id);
    repo.keep(bot, a.id);
    repo.ignore(bot, b.id);
    const mem = repo.get(bot);
    expect(mem.suggestions).toEqual([]);
    expect(mem.notes.map((n) => n.text)).toEqual(['Run yarn nx test opportunity, not the whole suite']);
    expect(() => repo.keep(bot, a.id)).toThrow(/gone/);

    const ctx = buildContext(bot, [bot], '/nonexistent/CLAUDE.md', [], repo.contextBlock(bot));
    expect(ctx).toContain("## What you've learned about this repo");
    expect(ctx).toContain('Run yarn nx test opportunity');
    expect(ctx).toContain('memory_note');
  });

  it('puts pinned notes first and caps the context size', () => {
    const repo = new MemoryRepository(new ProjectPaths(tmp()));
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `note ${i} ${'x'.repeat(200)}`, pinned: false }));
    repo.setNotes(bot, [...many, { text: 'Never run npm install', pinned: true }]);
    const block = repo.contextBlock(bot);
    expect(block.startsWith('- Never run npm install')).toBe(true);
    expect(block.length).toBeLessThanOrEqual(MEMORY_CONTEXT_LIMIT);
  });
});

describe('goal templates', () => {
  it('ships four parseable defaults and falls back to them', () => {
    const repo = new GoalTemplateRepository(path.join(tmp(), 'goal-templates'));
    const list = repo.list();
    expect(list.builtIn).toBe(true);
    expect(list.templates.map((t) => t.id)).toEqual(['bug-fix', 'new-endpoint', 'refactor', 'dependency-upgrade']);
    expect(list.templates[0]!.guidance).toMatch(/failing test/);
    expect(fs.existsSync(path.join(templatesDir(), 'goal-templates', 'bug-fix.md'))).toBe(true);
  });

  it('saves defaults into the repo, after which the repo copy is used', () => {
    const dir = path.join(tmp(), 'goal-templates');
    const repo = new GoalTemplateRepository(dir);
    expect(repo.saveDefaults().length).toBe(4);
    fs.writeFileSync(path.join(dir, 'zz-custom.md'), '---\nname: Spike\norder: 9\nfields:\n  - id: question\n    label: Question\n    required: true\n---\nTimebox to one hour.\n');
    const list = repo.list();
    expect(list.builtIn).toBe(false);
    expect(list.templates.at(-1)).toMatchObject({ id: 'zz-custom', name: 'Spike', guidance: 'Timebox to one hour.' });
  });

  it('composes the brief from fields and enforces required ones', () => {
    const t = parseTemplate('bug-fix', fs.readFileSync(path.join(templatesDir(), 'goal-templates', 'bug-fix.md'), 'utf8'));
    expect(() => composeBrief(t, { reproduce: 'click logout' })).toThrow(/What breaks\?" is required/);
    const brief = composeBrief(t, { problem: 'Logout stalls on 504', reproduce: 'Click logout while API is down' }, 'See WEB-4X');
    expect(brief.split('\n')[0]).toBe('Bug fix: Logout stalls on 504');
    expect(brief).toContain('**How to reproduce**\nClick logout while API is down');
    expect(brief).toContain('See WEB-4X');
  });
});

describe('phone approvals', () => {
  const setup = () => {
    let now = 1_000_000;
    const resolved: { id: string; allow: boolean; actor?: unknown }[] = [];
    const remote = new RemoteService({
      port: 4317,
      startTunnel: async () => ({ url: 'https://abc.trycloudflare.com', stop: () => {}, onExit: () => {} }),
      bots: () => [bot],
      gate: {
        pendingRequests: () => [
          { requestId: 'r1', botId: 'developer', tool: 'Bash', summary: 'git push', held: false },
          { requestId: 'r2', botId: 'developer', tool: 'Bash', summary: 'gh pr create', held: true },
        ],
        resolve: (id, allow, _always, actor) => void resolved.push({ id, allow, actor }),
      },
      notifications: { list: () => [{ id: 'n1', ts: 1, kind: NotificationKind.Question, title: 'Q', body: 'Which env?', read: false, botId: 'developer', options: ['staging'] }], answer: () => {} },
      goals: { list: () => [{ id: 'G-1', title: 'Fix logout', status: GoalStatus.AwaitingApproval } as never], approve: (id) => ({ id }) as never, replan: (id) => ({ id }) as never },
      tasks: () => [],
      audit: () => {},
      now: () => now,
    });
    return { remote, resolved, advance: (ms: number) => (now += ms) };
  };

  it('issues a separate token that expires', async () => {
    const { remote, advance } = setup();
    const s = await remote.enable(1);
    expect(s.state).toBe('on');
    const token = new URL(s.link!).searchParams.get('r')!;
    expect(remote.validate(token)).toBe(true);
    expect(remote.validate('nope')).toBe(false);
    advance(3600_000 + 1);
    expect(remote.validate(token)).toBe(false);
    expect(remote.status().state).toBe('off');
  });

  it('lists only what waits on the human, and never security-held requests', async () => {
    const { remote, resolved } = setup();
    await remote.enable(8);
    const p = remote.pending();
    expect(p.approvals.map((a) => a.requestId)).toEqual(['r1']);
    expect(p.questions[0]!.question).toBe('Which env?');
    expect(p.plans[0]!.goalId).toBe('G-1');
    expect(() => remote.decide('r2', true)).toThrow();
    remote.decide('r1', true);
    expect(resolved[0]).toMatchObject({ id: 'r1', allow: true, actor: { type: 'remote' } });
  });

  it('remote tokens reach only the remote API; the tunnel exposes nothing else', async () => {
    const { remote } = setup();
    const s = await remote.enable(8);
    const token = new URL(s.link!).searchParams.get('r')!;
    const app = new Hono();
    app.use('*', tunnelGuard());
    const api = new Hono();
    api.use('*', requireToken('session-token'));
    api.get('/info', (c) => c.json({ ok: true }));
    app.route('/api', api);
    remotePublicRoutes(app, remote);

    // A remote token is not a session token.
    expect((await app.request('/api/info', { headers: { 'x-agentroom-token': token } })).status).toBe(401);
    // Through the tunnel, the API is not even there.
    expect((await app.request('/api/info', { headers: { 'x-agentroom-token': 'session-token', 'cf-ray': 'x' } })).status).toBe(404);
    // The remote API needs the remote token.
    expect((await app.request('/remote-api/pending', { headers: { 'cf-ray': 'x' } })).status).toBe(401);
    const ok = await app.request('/remote-api/pending', { headers: { 'cf-ray': 'x', [REMOTE_TOKEN_HEADER]: token } });
    expect(ok.status).toBe(200);
    expect((await app.request('/m', { headers: { 'cf-ray': 'x' } })).status).toBe(200);
  });
});
