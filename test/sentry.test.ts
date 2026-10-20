import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextCursor } from '../src/server/integrations/sentry/sentry-client.js';
import { toEvent, toIssue } from '../src/server/integrations/sentry/sentry-mapper.js';
import { buildQuery, SentryService } from '../src/server/integrations/sentry/sentry.service.js';
import { buildSentryBrief, handoffSentry } from '../src/server/integrations/sentry/sentry-handoff.js';
import { SecretsStore } from '../src/server/services/secrets.store.js';
import type { Bot, GoalSource } from '../src/shared/types/index.js';

const rawIssue = {
  id: '4507',
  shortId: 'WEB-1A2',
  title: "TypeError: Cannot read properties of undefined (reading 'id')",
  culprit: 'checkout/cart.ts in applyCoupon',
  permalink: 'https://acme.sentry.io/issues/4507/',
  level: 'error',
  status: 'unresolved',
  substatus: 'regressed',
  isUnhandled: true,
  count: '1532',
  userCount: 87,
  firstSeen: '2026-10-01T10:00:00Z',
  lastSeen: '2026-10-19T09:30:00Z',
  project: { id: '11', slug: 'web', name: 'Web', platform: 'javascript-react' },
  metadata: { type: 'TypeError', value: "Cannot read properties of undefined (reading 'id')", filename: 'checkout/cart.ts', function: 'applyCoupon' },
  assignedTo: { type: 'user', name: 'Kinley', email: 'k@example.com' },
  priority: 'high',
  stats: { '24h': [[1, 0], [2, 4], [3, 9]] },
  numComments: 2,
};

const rawEvent = {
  eventID: 'abc123',
  dateCreated: '2026-10-19T09:30:00Z',
  tags: [{ key: 'environment', value: 'production' }, { key: 'release', value: 'web@2.4.1' }],
  contexts: { browser: { name: 'Chrome', version: '141' }, os: { name: 'macOS', version: '15' } },
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'TypeError',
            value: "Cannot read properties of undefined (reading 'id')",
            mechanism: { handled: false },
            stacktrace: {
              frames: [
                { filename: 'node_modules/react-dom/client.js', function: 'commitRoot', lineNo: 900, inApp: false, context: [] },
                { filename: 'src/checkout/cart.ts', function: 'applyCoupon', lineNo: 42, colNo: 17, inApp: true, context: [[41, 'const c = coupons[code]'], [42, '  return cart.total - c.discount.id'], [43, '}']] },
              ],
            },
          },
        ],
      },
    },
    { type: 'breadcrumbs', data: { values: [{ timestamp: '2026-10-19T09:29:58Z', category: 'ui.click', message: 'button#apply' }] } },
    { type: 'request', data: { url: 'https://shop.example.com/checkout', method: 'POST' } },
  ],
};

describe('Sentry mapping', () => {
  it('maps an issue', () => {
    const i = toIssue(rawIssue);
    expect(i).toMatchObject({ shortId: 'WEB-1A2', count: 1532, userCount: 87, unhandled: true, substatus: 'regressed', type: 'TypeError', priority: 'high', stats: [0, 4, 9] });
    expect(i.assignee).toEqual({ type: 'user', name: 'Kinley', email: 'k@example.com' });
  });

  it('maps the latest event: exceptions, frames, breadcrumbs, request, contexts', () => {
    const e = toEvent(rawEvent);
    expect(e.environment).toBe('production');
    expect(e.release).toBe('web@2.4.1');
    expect(e.exceptions[0]).toMatchObject({ type: 'TypeError', handled: false });
    expect(e.exceptions[0]!.frames[1]).toMatchObject({ filename: 'src/checkout/cart.ts', lineNo: 42, inApp: true });
    expect(e.breadcrumbs[0]).toMatchObject({ category: 'ui.click' });
    expect(e.request).toEqual({ url: 'https://shop.example.com/checkout', method: 'POST' });
    expect(e.contexts).toEqual([{ name: 'browser', value: 'Chrome 141' }, { name: 'os', value: 'macOS 15' }]);
  });

  it('tolerates junk', () => {
    expect(toIssue(null).title).toBe('(no title)');
    expect(toEvent({ entries: 'x' }).exceptions).toEqual([]);
  });
});

describe('Sentry queries', () => {
  it('combines filters with the search text', () => {
    expect(buildQuery({})).toBe('is:unresolved');
    expect(buildQuery({ status: 'all', level: 'error', assigned: 'unassigned', query: 'url:*checkout*' })).toBe('level:error is:unassigned url:*checkout*');
  });

  it('reads the next cursor only when there are more results', () => {
    expect(nextCursor('<a>; rel="previous"; results="false"; cursor="0:0:1", <b>; rel="next"; results="true"; cursor="0:25:0"')).toBe('0:25:0');
    expect(nextCursor('<b>; rel="next"; results="false"; cursor="0:25:0"')).toBeNull();
  });
});

describe('SentryService', () => {
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-sentry-'));
    const secrets = new SecretsStore(path.join(dir, 'secrets.json'));
    const calls: { url: URL; auth: string | null }[] = [];
    const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
      const json = (data: unknown, link?: string) => new Response(JSON.stringify(data), { status: 200, headers: link ? { link } : {} });
      if (url.pathname === '/api/0/organizations/') return json([{ slug: 'acme', name: 'Acme', links: { regionUrl: 'https://de.sentry.io' } }]);
      if (url.pathname.endsWith('/projects/')) return json([{ id: '11', slug: 'web', name: 'Web' }, { id: '12', slug: 'api', name: 'API' }]);
      if (url.pathname.endsWith('/organizations/acme/issues/')) return json([rawIssue], '<x>; rel="next"; results="true"; cursor="0:25:0"');
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    return { secrets, calls, service: new SentryService(path.join(dir, 'sentry.json'), secrets, fetchImpl), dir };
  };

  it('needs a token, then talks to the org region with project ids and filters', async () => {
    const { secrets, calls, service } = setup();
    await expect(service.issues()).rejects.toThrow(/not connected/);
    secrets.setMcpSecrets({ SENTRY_ACCESS_TOKEN: 'sntrys_test' });
    await service.connect({ org: 'acme', projects: ['web'] });
    const page = await service.issues({ level: 'error', period: '24h' });
    expect(page.issues[0]!.shortId).toBe('WEB-1A2');
    expect(page.nextCursor).toBe('0:25:0');
    const call = calls.at(-1)!;
    expect(call.url.origin).toBe('https://de.sentry.io');
    expect(call.url.searchParams.get('project')).toBe('11');
    expect(call.url.searchParams.get('query')).toBe('is:unresolved level:error');
    expect(call.url.searchParams.get('statsPeriod')).toBe('24h');
    expect(call.auth).toBe('Bearer sntrys_test');
    expect(service.status()).toMatchObject({ hasToken: true, config: { org: 'acme', regionUrl: 'https://de.sentry.io', projects: ['web'] } });
  });
  it('in a workspace, adds the other repos’ projects (same org), tags their issues and filters by repo', async () => {
    const { secrets, calls, service } = setup();
    secrets.setMcpSecrets({ SENTRY_ACCESS_TOKEN: 'sntrys_test' });
    await service.connect({ org: 'acme', projects: ['api'] });
    service.useRepos('shop-api', () => [
      { repo: 'shop-web', config: { org: 'acme', projects: ['web'] } },
      // Another org would need its own token: skipped.
      { repo: 'other', config: { org: 'elsewhere', projects: ['x'] } },
    ]);
    expect(service.status().repoProjects).toEqual([{ repo: 'shop-web', projects: ['web'] }]);
    const all = await service.issues();
    expect(calls.at(-1)!.url.searchParams.getAll('project').sort()).toEqual(['11', '12']);
    expect(all.issues[0]!.repo).toBe('shop-web');
    await service.issues({ repo: 'shop-web' });
    expect(calls.at(-1)!.url.searchParams.getAll('project')).toEqual(['11']);
    await service.issues({ repo: 'shop-api' });
    expect(calls.at(-1)!.url.searchParams.getAll('project')).toEqual(['12']);
    expect((await service.issues({ repo: 'nope' })).issues).toEqual([]);
  });
});

describe('Sentry hand-off', () => {
  it('routes issues from another workspace repo to that repo', async () => {
    let brief = '';
    const issue = { ...toIssue(rawIssue), repo: 'shop-web' };
    await handoffSentry(
      {
        root: os.tmpdir(),
        bots: () => [{ id: 'lead', name: 'Team Lead', role: 'lead', order: 1 }] as unknown as Bot[],
        detail: async () => ({ issue, event: toEvent(rawEvent), tags: [] }),
        startGoal: (b) => ((brief = b), { id: 'G-1' } as never),
        sendToBot: () => {},
        repoRoot: (r) => (r === 'shop-web' ? '/code/shop-web' : undefined),
      },
      { issueIds: ['1'] },
    );
    expect(brief).toContain('Where the code is');
    expect(brief).toContain('repo: "shop-web"');
  });

  const bots = [
    { id: 'lead', name: 'Team Lead', role: 'lead', order: 1 },
    { id: 'fixer', name: 'Bug Fixer', role: 'developer', reportsTo: 'lead', order: 2 },
  ] as unknown as Bot[];
  const detail = { issue: toIssue(rawIssue), event: toEvent(rawEvent), tags: [] };

  it('briefs with the in-app frame, breadcrumbs and fix steps, wrapped as untrusted', () => {
    const brief = buildSentryBrief([detail], { note: 'Only the coupon flow', files: [], links: [], guard: (t, s) => `<untrusted source="${s}">${t}</untrusted>`, sentryTools: true });
    expect(brief).toContain('### WEB-1A2');
    expect(brief).toContain('src/checkout/cart.ts:42 in applyCoupon');
    expect(brief).toContain('return cart.total - c.discount.id');
    expect(brief).not.toContain('react-dom/client.js');
    expect(brief).toContain('<untrusted source="Sentry WEB-1A2">');
    expect(brief).toContain('Fixes WEB-1A2');
    expect(brief).toContain('Sentry MCP tools');
    expect(brief).toContain('Only the coupon flow');
  });

  it('lead starts a goal with a sentry source; another bot gets a message', async () => {
    const started: { title: string; sources: unknown[] }[] = [];
    const sent: string[] = [];
    const deps = {
      root: os.tmpdir(),
      bots: () => bots,
      detail: async () => detail,
      startGoal: (_b: string, title: string, sources: GoalSource[]) => (started.push({ title, sources }), { id: 'G-1' } as never),
      sendToBot: (id: string) => void sent.push(id),
    };
    const a = await handoffSentry(deps, { issueIds: ['4507'] });
    expect(a.goal).toBeDefined();
    expect(started[0]!.title).toBe("Fix WEB-1A2: TypeError: Cannot read properties of undefined (reading 'id')".slice(0, 80));
    expect(started[0]!.sources[0]).toMatchObject({ type: 'sentry', itemId: '4507', shortId: 'WEB-1A2' });
    const b = await handoffSentry(deps, { issueIds: ['4507'], botId: 'fixer' });
    expect(b).toEqual({ botId: 'fixer' });
    expect(sent).toEqual(['fixer']);
  });
});
