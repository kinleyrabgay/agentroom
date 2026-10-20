import type { TrackerIssue, TrackerIssueDetail, TrackerIssueFilters, TrackerScope, TrackerState } from '../../../shared/types/index.js';
import { TrackerError, type FetchLike, type TrackerClient } from './tracker-client.js';

const PAGE = 100;
const FIELDS = 'summary,status,priority,assignee,labels,updated,issuetype';

/** Jira status categories → ours ("In Review" style names count as review). */
function category(cat: string | undefined, name: string): TrackerState['category'] {
  if (cat === 'done') return /cancel|won.?t|reject|declin/i.test(name) ? 'canceled' : 'done';
  if (cat === 'indeterminate') return /review|qa|test/i.test(name) ? 'review' : 'started';
  return /backlog/i.test(name) ? 'backlog' : 'todo';
}

interface RawStatus {
  id: string;
  name: string;
  statusCategory?: { key: string };
}
interface RawIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: RawStatus;
    priority?: { id: string; name: string } | null;
    assignee?: { displayName: string; avatarUrls?: Record<string, string> } | null;
    labels?: string[];
    updated: string;
    issuetype?: { name: string } | null;
    description?: unknown;
    comment?: { comments: { author?: { displayName: string }; body: unknown; created: string }[] };
  };
}

/** Normalise "acme", "acme.atlassian.net" or a URL to "acme.atlassian.net". */
export function jiraSite(input: string): string {
  const s = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!s) throw new TrackerError('Enter your Jira site, e.g. acme.atlassian.net.');
  const host = s.includes('.') ? s : `${s}.atlassian.net`;
  if (!/^[a-z0-9.-]+$/.test(host)) throw new TrackerError('That doesn’t look like a Jira site.');
  return host;
}

/** Jira Cloud REST v3 with an account email + API token (id.atlassian.com → Security → API tokens). */
export class JiraClient implements TrackerClient {
  private readonly base: string;
  private readonly auth: string;

  constructor(
    site: string,
    email: string,
    token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.base = `https://${jiraSite(site)}`;
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  private async req<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method: init.method ?? 'GET',
        headers: { authorization: this.auth, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new TrackerError(`Couldn't reach Jira: ${(err as Error).message}`);
    }
    if (res.status === 401) throw new TrackerError('Jira rejected the email or API token.', true);
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as (T & { errorMessages?: string[]; errors?: Record<string, string> }) | null;
    if (!res.ok) {
      const msg = [...(json?.errorMessages ?? []), ...Object.values(json?.errors ?? {})].join('; ') || `HTTP ${res.status}`;
      throw new TrackerError(`Jira: ${msg}`);
    }
    return json as T;
  }

  async viewer() {
    const me = await this.req<{ displayName: string; emailAddress?: string }>('/rest/api/3/myself');
    return { name: me.displayName, ...(me.emailAddress ? { email: me.emailAddress } : {}) };
  }

  async scopes(): Promise<TrackerScope[]> {
    const page = await this.req<{ values: { id: string; key: string; name: string }[] }>('/rest/api/3/project/search?maxResults=100&orderBy=name');
    return page.values.map((p) => ({ id: p.key, key: p.key, name: p.name }));
  }

  async states(projectKey: string): Promise<TrackerState[]> {
    const types = await this.req<{ statuses: RawStatus[] }[]>(`/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`);
    const seen = new Map<string, TrackerState>();
    for (const t of types) for (const s of t.statuses) if (!seen.has(s.name)) seen.set(s.name, toState(s));
    const rank: TrackerState['category'][] = ['backlog', 'todo', 'started', 'review', 'done', 'canceled'];
    return [...seen.values()].sort((a, b) => rank.indexOf(a.category) - rank.indexOf(b.category));
  }

  async issues(projectKey: string, f: TrackerIssueFilters = {}, extra?: string): Promise<TrackerIssue[]> {
    const jql = [`project = ${quote(projectKey)}`];
    if (!f.closed) jql.push('statusCategory != Done');
    if (f.states?.length) jql.push(`status in (${f.states.map(quote).join(', ')})`);
    if (f.mine) jql.push('assignee = currentUser()');
    if (f.query?.trim()) jql.push(`text ~ ${quote(f.query.trim())}`);
    if (extra?.trim()) jql.push(`(${extra.trim()})`);
    const q = new URLSearchParams({ jql: `${jql.join(' AND ')} ORDER BY updated DESC`, fields: FIELDS, maxResults: String(PAGE) });
    const page = await this.req<{ issues: RawIssue[] }>(`/rest/api/3/search/jql?${q}`);
    return page.issues.map((i) => this.toIssue(i));
  }

  async issue(idOrKey: string): Promise<TrackerIssueDetail> {
    const i = await this.req<RawIssue>(`/rest/api/3/issue/${encodeURIComponent(idOrKey)}?fields=${FIELDS},description,comment`);
    return {
      issue: this.toIssue(i),
      description: adfText(i.fields.description),
      comments: (i.fields.comment?.comments ?? []).slice(-30).map((c) => ({ author: c.author?.displayName ?? 'Jira', body: adfText(c.body), createdAt: c.created })),
    };
  }

  async moveTo(idOrKey: string, stateName: string): Promise<void> {
    const key = encodeURIComponent(idOrKey);
    const { transitions } = await this.req<{ transitions: { id: string; name: string; to: { name: string } }[] }>(`/rest/api/3/issue/${key}/transitions`);
    const want = stateName.trim().toLowerCase();
    const t = transitions.find((x) => x.to.name.toLowerCase() === want) ?? transitions.find((x) => x.name.toLowerCase() === want);
    if (!t) throw new TrackerError(`Jira can't move ${idOrKey} to "${stateName}" from its current status.`);
    await this.req(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id: t.id } } });
  }

  async comment(idOrKey: string, body: string): Promise<void> {
    await this.req(`/rest/api/3/issue/${encodeURIComponent(idOrKey)}/comment`, { method: 'POST', body: { body: adfDoc(body) } });
  }

  private toIssue(i: RawIssue): TrackerIssue {
    const f = i.fields;
    return {
      id: i.id,
      key: i.key,
      title: f.summary,
      url: `${this.base}/browse/${i.key}`,
      state: toState(f.status),
      // Jira's default scheme: 1 Highest … 5 Lowest.
      ...(f.priority ? { priority: { value: Number(f.priority.id) || 0, label: f.priority.name } } : {}),
      ...(f.assignee ? { assignee: { name: f.assignee.displayName, ...(f.assignee.avatarUrls?.['24x24'] ? { avatarUrl: f.assignee.avatarUrls['24x24'] } : {}) } } : {}),
      labels: f.labels ?? [],
      ...(f.issuetype?.name ? { type: f.issuetype.name } : {}),
      updatedAt: f.updated,
    };
  }
}

const toState = (s: RawStatus): TrackerState => ({ id: s.id, name: s.name, category: category(s.statusCategory?.key, s.name) });
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Atlassian Document Format → plain text (paragraphs, lists, code, mentions). */
export function adfText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'mention') return String(n.attrs?.text ?? '@someone');
  if (n.type === 'inlineCard') return String(n.attrs?.url ?? '');
  const inner = (n.content ?? []).map(adfText);
  switch (n.type) {
    case 'paragraph':
    case 'heading':
      return `${inner.join('')}\n\n`;
    case 'listItem':
      return `- ${inner.join('').trim()}\n`;
    case 'bulletList':
    case 'orderedList':
      return `${inner.join('')}\n`;
    case 'codeBlock':
      return `\`\`\`\n${inner.join('')}\n\`\`\`\n\n`;
    default:
      return inner.join('');
  }
}

/** Plain text → a minimal ADF document (one paragraph per line). */
export function adfDoc(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  };
}
