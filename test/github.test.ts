import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { explainGhError, type GhClient } from '../src/server/integrations/github/gh-client.js';
import { GithubProjectService } from '../src/server/integrations/github/github-project.service.js';
import { buildBrief, HandoffService } from '../src/server/integrations/github/handoff.service.js';
import { parseProjectUrl } from '../src/server/integrations/github/url.js';
import type { Bot, GithubItemDetail } from '../src/shared/types/index.js';

type Call = { query: string; vars: Record<string, unknown> };

const statusField = (opts: { id: string; name: string }[]) => ({ id: 'F1', name: 'Status', options: opts });
const rawItem = (id: string, status: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  fieldValues: {
    nodes: [
      ...(status ? [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: status, name: status, field: { id: 'F1', name: 'Status' } }] : []),
      { __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: 'P1', name: '🏔 High', field: { id: 'F2', name: 'Priority' } },
      { __typename: 'ProjectV2ItemFieldIterationValue', title: 'Sprint 7', field: { id: 'F3', name: 'Sprints' } },
    ],
  },
  content: {
    __typename: 'Issue', id: `I_${id}`, number: 12, title: `Card ${id}`, url: `https://github.com/o/r/issues/12`, state: 'OPEN',
    updatedAt: '2026-10-01T00:00:00Z', repository: { nameWithOwner: 'o/r' },
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    assignees: { nodes: [{ login: 'someone', avatarUrl: 'a' }] },
    closedByPullRequestsReferences: { nodes: [{ number: 3, url: 'https://github.com/o/r/pull/3', state: 'OPEN' }] },
    ...extra,
  },
});

class FakeGh implements GhClient {
  calls: Call[] = [];
  columns = [{ id: 'S1', name: 'Todo' }, { id: 'S2', name: 'Done' }];
  pages: ReturnType<typeof rawItem>[][] = [[rawItem('A', 'S1'), rawItem('B', null)]];
  fail: string | null = null;
  async graphql<T>(query: string, vars: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ query, vars });
    if (this.fail) throw new Error(this.fail);
    if (query.includes('fields(first: 50)')) {
      return { owner: { projectV2: { id: 'PVT_1', title: 'Board', fields: { nodes: [null, statusField(this.columns)] } } } } as T;
    }
    if (query.includes('items(first: 100')) {
      const page = vars.after ? Number(vars.after) : 0;
      return {
        viewer: { login: 'me', avatarUrl: 'm' },
        owner: { projectV2: { items: { pageInfo: { hasNextPage: page + 1 < this.pages.length, endCursor: String(page + 1) }, nodes: this.pages[page] } } },
      } as T;
    }
    if (query.includes('node(id:')) {
      return { node: { ...rawItem(String(vars.id), 'S1'), body: { body: 'Steps to reproduce', comments: { nodes: [{ author: { login: 'pm' }, body: 'Please fix', createdAt: '2026-10-02T00:00:00Z' }] } } } } as T;
    }
    if (query.includes('viewer { id')) return { viewer: { id: 'U_me', login: 'me', avatarUrl: 'm' } } as T;
    return {} as T;
  }
}

let dir: string;
let gh: FakeGh;
let now: number;
let svc: GithubProjectService;
const paths = () => ({ projectFile: path.join(dir, 'github', 'project.json'), itemsCache: path.join(dir, 'runs', 'github-items.json') });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-gh-'));
  gh = new FakeGh();
  now = Date.parse('2026-10-19T10:00:00Z');
  svc = new GithubProjectService(gh, paths(), () => now);
});

describe('parseProjectUrl', () => {
  it('accepts org and user projects, ignoring views', () => {
    expect(parseProjectUrl('https://github.com/orgs/acme/projects/472/views/3?filterQuery=x')).toEqual({
      ownerType: 'org', owner: 'acme', number: 472, url: 'https://github.com/orgs/acme/projects/472',
    });
    expect(parseProjectUrl('https://github.com/users/kin/projects/1').ownerType).toBe('user');
    expect(() => parseProjectUrl('https://github.com/acme/repo/issues/1')).toThrow(/project URL/);
  });
});

describe('explainGhError', () => {
  it('turns gh failures into actionable messages', () => {
    expect(explainGhError('', 'ENOENT')).toMatch(/Install the GitHub CLI/);
    expect(explainGhError('INSUFFICIENT_SCOPES: requires read:project')).toMatch(/gh auth refresh -s project/);
    expect(explainGhError('You are not logged into any GitHub hosts')).toMatch(/gh auth refresh -s project/);
  });
});

describe('GithubProjectService', () => {
  it('connects: resolves the project, caches columns in project.json', async () => {
    const cfg = await svc.connect('https://github.com/orgs/acme/projects/5');
    expect(cfg).toMatchObject({ owner: 'acme', number: 5, projectId: 'PVT_1', title: 'Board', statusField: { id: 'F1' } });
    expect(cfg.columns.map((c) => c.name)).toEqual(['Todo', 'Done']);
    expect(JSON.parse(fs.readFileSync(paths().projectFile, 'utf8')).columns).toHaveLength(2);
    expect(gh.calls[0].vars).toEqual({ owner: 'acme', number: 5 });
  });

  it('is cache-first; refresh fetches all pages and writes the cache', async () => {
    await svc.connect('https://github.com/orgs/acme/projects/5');
    gh.pages = [[rawItem('A', 'S1')], [rawItem('B', 'S2')]];
    const first = await svc.board();
    expect(first.items.map((i) => i.id)).toEqual(['A', 'B']);
    expect(first.items[0]).toMatchObject({ repo: 'o/r', number: 12, statusId: 'S1', priority: '🏔 High', iteration: 'Sprint 7', labels: [{ name: 'bug' }], linkedPrs: [{ number: 3 }] });
    expect(first.viewer).toEqual({ login: 'me', avatarUrl: 'm' });

    const callsBefore = gh.calls.length;
    const cached = await svc.board();
    expect(gh.calls.length).toBe(callsBefore);
    expect(cached.items).toHaveLength(2);

    gh.pages = [[rawItem('C', 'S1')]];
    expect((await svc.board({ refresh: true })).items.map((i) => i.id)).toEqual(['C']);
    expect(JSON.parse(fs.readFileSync(paths().itemsCache, 'utf8')).items).toHaveLength(1);
  });

  it('re-syncs columns on an unknown status and once a day', async () => {
    await svc.connect('https://github.com/orgs/acme/projects/5');
    gh.columns = [...gh.columns, { id: 'S3', name: 'QA' }];
    gh.pages = [[rawItem('A', 'S3')]];
    const board = await svc.board({ refresh: true });
    expect(board.project.columns.map((c) => c.id)).toContain('S3');

    gh.columns = [...gh.columns, { id: 'S4', name: 'Released' }];
    gh.pages = [[rawItem('A', 'S1')]];
    expect((await svc.board({ refresh: true })).project.columns).toHaveLength(3);
    now += 25 * 60 * 60 * 1000;
    expect((await svc.board({ refresh: true })).project.columns).toHaveLength(4);
  });

  it('serves the cache marked stale when GitHub fails', async () => {
    await svc.connect('https://github.com/orgs/acme/projects/5');
    await svc.board({ refresh: true });
    gh.fail = 'network down';
    const board = await svc.board({ refresh: true });
    expect(board.stale?.reason).toBe('network down');
    expect(board.items).toHaveLength(2);
  });

  it('assigns and unassigns the viewer, updating the cache', async () => {
    await svc.connect('https://github.com/orgs/acme/projects/5');
    await svc.board({ refresh: true });
    const assigned = await svc.setAssigned('A', true);
    const add = gh.calls.find((c) => c.query.includes('addAssigneesToAssignable'));
    expect(add?.vars).toEqual({ assignable: 'I_A', user: 'U_me' });
    expect(assigned.assignees.map((a) => a.login)).toEqual(['someone', 'me']);
    expect((await svc.board()).items.find((i) => i.id === 'A')?.assignees).toHaveLength(2);

    const removed = await svc.setAssigned('A', false);
    expect(gh.calls.some((c) => c.query.includes('removeAssigneesFromAssignable'))).toBe(true);
    expect(removed.assignees.map((a) => a.login)).toEqual(['someone']);
  });

  it('refuses to assign draft cards and loads card details', async () => {
    await svc.connect('https://github.com/orgs/acme/projects/5');
    gh.pages = [[rawItem('D', 'S1', { __typename: 'DraftIssue', id: undefined, number: undefined, repository: undefined })]];
    await svc.board({ refresh: true });
    await expect(svc.setAssigned('D', true)).rejects.toThrow(/Draft/);
    const detail = await svc.itemDetail('A');
    expect(detail.body).toBe('Steps to reproduce');
    expect(detail.comments).toEqual([{ author: 'pm', body: 'Please fix', createdAt: '2026-10-02T00:00:00Z' }]);
  });

  it('keeps hidden columns valid and disconnects cleanly', async () => {
    await svc.connect('https://github.com/orgs/acme/projects/5');
    expect(svc.setHiddenColumns(['S2', 'nope']).hiddenColumns).toEqual(['S2']);
    svc.disconnect();
    expect(svc.config()).toBeNull();
    await expect(svc.board()).rejects.toThrow(/No GitHub project/);
  });
});

describe('hand-off', () => {
  const bot = (id: string, role: string, reportsTo?: string): Bot =>
    ({ id, name: id, role, reportsTo, tools: [], skills: [], localSkills: [], prompt: '', dir: id, order: 0, color: '', avatar: '' }) as Bot;
  const detail = (id: string): GithubItemDetail => ({
    item: { id, contentId: `I_${id}`, type: 'Issue', repo: 'o/r', number: 7, title: `Fix ${id}`, url: `https://github.com/o/r/issues/7`, statusId: null, labels: [{ name: 'bug', color: 'x' }], assignees: [], linkedPrs: [], updatedAt: '' },
    body: 'Body text',
    comments: [{ author: 'pm', body: 'note', createdAt: '2026-10-02T00:00:00Z' }],
  });

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-hand-'));
    fs.writeFileSync(path.join(root, 'SPEC.md'), '# spec');
    const started: { brief: string; title: string; sources: unknown[] }[] = [];
    const sent: { botId: string; text: string }[] = [];
    const svc = new HandoffService({
      root,
      bots: () => [bot('team-lead', 'lead'), bot('qa', 'qa', 'team-lead')],
      itemDetail: async (id) => detail(id),
      startGoal: (brief, title, sources) => {
        started.push({ brief, title, sources });
        return { id: 'G-1' } as never;
      },
      sendToBot: (botId, text) => sent.push({ botId, text }),
    });
    return { svc, started, sent };
  }

  it('gives cards to the Team Lead as a goal with sources', async () => {
    const { svc, started } = setup();
    const res = await svc.handoff({ itemIds: ['A', 'B'], note: 'Do A first', files: ['SPEC.md'], links: ['https://github.com/o/r/pull/9'] });
    expect(res).toMatchObject({ botId: 'team-lead', goal: { id: 'G-1' } });
    expect(started[0].title).toBe('2 GitHub cards: Fix A');
    expect(started[0].sources).toEqual([
      { type: 'github', itemId: 'A', title: 'Fix A', url: 'https://github.com/o/r/issues/7', number: 7, repo: 'o/r' },
      { type: 'github', itemId: 'B', title: 'Fix B', url: 'https://github.com/o/r/issues/7', number: 7, repo: 'o/r' },
    ]);
    expect(started[0].brief).toContain('### o/r#7 Fix A');
    expect(started[0].brief).toContain('## Notes from the human\nDo A first');
    expect(started[0].brief).toContain('- `SPEC.md`');
    expect(started[0].brief).toContain('- https://github.com/o/r/pull/9');
  });

  it('sends to another bot directly, and validates input', async () => {
    const { svc, sent, started } = setup();
    expect(await svc.handoff({ itemIds: ['A'], botId: 'qa' })).toEqual({ botId: 'qa' });
    expect(sent[0].botId).toBe('qa');
    expect(started).toHaveLength(0);
    await expect(svc.handoff({ itemIds: [] })).rejects.toThrow(/Select at least one/);
    await expect(svc.handoff({ itemIds: ['A'], files: ['../../etc/passwd'] })).rejects.toThrow(/outside the repository/);
    await expect(svc.handoff({ itemIds: ['A'], files: ['missing.md'] })).rejects.toThrow(/doesn't exist/);
    await expect(svc.handoff({ itemIds: ['A'], links: ['javascript:x'] })).rejects.toThrow(/isn't a link/);
    await expect(svc.handoff({ itemIds: ['A'], botId: 'ghost' })).rejects.toThrow(/Unknown bot/);
  });

  it('builds a brief with comments', () => {
    const brief = buildBrief([detail('A')], '', [], []);
    expect(brief).toMatch(/^Work on this GitHub card\./);
    expect(brief).toContain('Labels: bug');
    expect(brief).toContain('- @pm (2026-10-02): note');
  });
});
