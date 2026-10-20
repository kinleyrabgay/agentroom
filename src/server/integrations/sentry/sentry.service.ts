import fs from 'node:fs';
import { z } from 'zod';
import type {
  SentryConfig,
  SentryIssueDetail,
  SentryIssuePage,
  SentryIssueQuery,
  SentryOrg,
  SentryProject,
  SentryStatus,
} from '../../../shared/types/index.js';
import { readJson, writeJson } from '../../../core/fs/json.js';
import type { SecretsStore } from '../../services/secrets.store.js';
import { SentryClient, type Fetch } from './sentry-client.js';
import { toEvent, toIssue, toTags } from './sentry-mapper.js';

/** Same secret the Sentry MCP preset uses, so one token serves both. */
export const SENTRY_TOKEN_SECRET = 'SENTRY_ACCESS_TOKEN';
export const SENTRY_CLOUD = 'https://sentry.io';
const PAGE_SIZE = 25;
const DETAIL_TTL_MS = 60_000;
const PROJECTS_TTL_MS = 10 * 60_000;

const ConfigSchema = z.object({
  host: z.string().url().default(SENTRY_CLOUD),
  org: z.string().min(1),
  orgName: z.string().optional(),
  regionUrl: z.string().url().optional(),
  projects: z.array(z.string()).default([]),
  environment: z.string().optional(),
});

/**
 * The Sentry page: which org/projects (`.agentroom/sentry.json`, committed), issues and their latest event.
 * Read-only: nothing is written to Sentry.
 */
export class SentryService {
  private readonly client: SentryClient;
  private details = new Map<string, { at: number; value: SentryIssueDetail }>();
  private projectsCache?: { at: number; org: string; list: SentryProject[] };

  constructor(
    private readonly file: string,
    private readonly secrets: SecretsStore,
    fetchImpl?: Fetch,
  ) {
    this.client = new SentryClient(() => this.secrets.mcpSecret(SENTRY_TOKEN_SECRET), fetchImpl);
  }

  private repoSources: () => { repo: string; config: { org?: string; projects?: string[] } | null }[] = () => [];
  private primaryRepo = '';

  /**
   * Workspaces: the other repos' `sentry.json`. Their projects in the same org join the Sentry page
   * (tagged with the repo); another org would need its own token, so those are skipped.
   */
  useRepos(primaryRepo: string, sources: () => { repo: string; config: { org?: string; projects?: string[] } | null }[]) {
    this.primaryRepo = primaryRepo;
    this.repoSources = sources;
  }

  /** Projects of the other repos (same org as this one), per repo. */
  repoProjects(): { repo: string; projects: string[] }[] {
    const org = this.config()?.org;
    if (!org) return [];
    const out: { repo: string; projects: string[] }[] = [];
    for (const s of this.repoSources()) {
      if (s.config?.org !== org || !s.config.projects?.length) continue;
      out.push({ repo: s.repo, projects: [...new Set(s.config.projects)] });
    }
    return out;
  }

  /** Which repo an issue's project belongs to (unset = the primary repo). */
  private tag<T extends { project: { slug: string } }>(issue: T): T & { repo?: string } {
    const own = this.config()?.projects ?? [];
    if (own.includes(issue.project.slug)) return issue;
    const hit = this.repoProjects().find((r) => r.projects.includes(issue.project.slug));
    return hit ? { ...issue, repo: hit.repo } : issue;
  }

  config(): SentryConfig | null {
    if (!fs.existsSync(this.file)) return null;
    const parsed = ConfigSchema.safeParse(readJson(this.file, {}));
    return parsed.success ? parsed.data : null;
  }

  status(): SentryStatus {
    const repoProjects = this.repoProjects();
    return { config: this.config(), hasToken: !!this.secrets.mcpSecret(SENTRY_TOKEN_SECRET), ...(repoProjects.length ? { repoProjects } : {}) };
  }

  /** Check and store a token; returns the orgs it can see. */
  async setToken(token: string, host = this.config()?.host ?? SENTRY_CLOUD): Promise<SentryOrg[]> {
    const t = token.trim();
    if (!t) throw new Error('Paste a Sentry token.');
    const probe = new SentryClient(() => t);
    const orgs = await listOrgs(probe, normalizeHost(host));
    this.secrets.setMcpSecrets({ [SENTRY_TOKEN_SECRET]: t });
    return orgs;
  }

  orgs(host = this.config()?.host ?? SENTRY_CLOUD): Promise<SentryOrg[]> {
    return listOrgs(this.client, normalizeHost(host));
  }

  async projects(org = this.config()?.org): Promise<SentryProject[]> {
    if (!org) throw new Error('Pick a Sentry organization first.');
    const cached = this.projectsCache;
    if (cached && cached.org === org && Date.now() - cached.at < PROJECTS_TTL_MS) return cached.list;
    const base = await this.baseFor(org);
    const list: SentryProject[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await this.client.get<unknown[]>(base, `api/0/organizations/${enc(org)}/projects/`, { cursor });
      for (const p of res.data as Record<string, unknown>[]) {
        list.push({ id: String(p.id), slug: String(p.slug), name: String(p.name ?? p.slug), ...(p.platform ? { platform: String(p.platform) } : {}) });
      }
      if (!res.next) break;
      cursor = res.next;
    }
    list.sort((a, b) => a.slug.localeCompare(b.slug));
    this.projectsCache = { at: Date.now(), org, list };
    return list;
  }

  async environments(): Promise<string[]> {
    const cfg = this.require();
    const res = await this.client.get<{ name: string }[]>(await this.baseFor(cfg.org), `api/0/organizations/${enc(cfg.org)}/environments/`);
    return res.data.map((e) => e.name).filter(Boolean).sort();
  }

  async connect(input: { org: string; projects?: string[]; environment?: string; host?: string }): Promise<SentryStatus> {
    const host = normalizeHost(input.host ?? this.config()?.host ?? SENTRY_CLOUD);
    const orgs = await listOrgs(this.client, host);
    const org = orgs.find((o) => o.slug === input.org);
    if (!org) throw new Error(`The token can't see a Sentry organization "${input.org}".`);
    const config: SentryConfig = {
      host,
      org: org.slug,
      orgName: org.name,
      ...(org.regionUrl ? { regionUrl: org.regionUrl } : {}),
      projects: [...new Set(input.projects ?? [])],
      ...(input.environment ? { environment: input.environment } : {}),
    };
    writeJson(this.file, config);
    this.details.clear();
    this.projectsCache = undefined;
    return this.status();
  }

  disconnect() {
    if (fs.existsSync(this.file)) fs.rmSync(this.file);
    this.details.clear();
    this.projectsCache = undefined;
  }

  async issues(q: SentryIssueQuery = {}): Promise<SentryIssuePage> {
    const cfg = this.require();
    const others = this.repoProjects();
    // A repo filter picks that repo's projects; otherwise the page shows this repo's and the other repos' projects.
    const ofRepo = q.repo ? (q.repo === this.primaryRepo ? cfg.projects : (others.find((r) => r.repo === q.repo)?.projects ?? [])) : null;
    if (q.repo && !ofRepo?.length) return { issues: [], nextCursor: null, fetchedAt: new Date().toISOString() };
    const slugs = q.projects?.length ? q.projects : (ofRepo ?? (cfg.projects.length ? [...new Set([...cfg.projects, ...others.flatMap((r) => r.projects)])] : []));
    const ids = slugs.length ? await this.projectIds(slugs) : undefined;
    const res = await this.client.get<unknown[]>(await this.baseFor(cfg.org), `api/0/organizations/${enc(cfg.org)}/issues/`, {
      query: buildQuery(q),
      project: ids,
      environment: q.environment ?? cfg.environment,
      statsPeriod: q.period ?? '14d',
      groupStatsPeriod: '24h',
      sort: q.sort ?? 'date',
      limit: String(PAGE_SIZE),
      shortIdLookup: '1',
      cursor: q.cursor,
    });
    return { issues: res.data.map((d) => this.tag(toIssue(d))), nextCursor: res.next, fetchedAt: new Date().toISOString() };
  }

  /** Issue + its latest event (stack trace, breadcrumbs) + top tags. Cached for a minute. */
  async detail(id: string, { fresh = false } = {}): Promise<SentryIssueDetail> {
    if (!/^\d+$/.test(id)) throw new Error('Invalid Sentry issue id.');
    const hit = this.details.get(id);
    if (!fresh && hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.value;
    const cfg = this.require();
    const base = await this.baseFor(cfg.org);
    const org = enc(cfg.org);
    const get = <T>(path: string, legacy: string) =>
      this.client.get<T>(base, path).catch((err: { status?: number }) => {
        // Older/self-hosted Sentry only has the non-org-scoped routes.
        if (err.status === 404) return this.client.get<T>(base, legacy);
        throw err;
      });
    const [issue, event, tags] = await Promise.all([
      get<unknown>(`api/0/organizations/${org}/issues/${id}/`, `api/0/issues/${id}/`),
      get<unknown>(`api/0/organizations/${org}/issues/${id}/events/latest/`, `api/0/issues/${id}/events/latest/`).catch(() => null),
      get<unknown>(`api/0/organizations/${org}/issues/${id}/tags/`, `api/0/issues/${id}/tags/`).catch(() => null),
    ]);
    const value: SentryIssueDetail = { issue: this.tag(toIssue(issue.data)), event: event ? toEvent(event.data) : null, tags: tags ? toTags(tags.data) : [] };
    this.details.set(id, { at: Date.now(), value });
    return value;
  }

  private require(): SentryConfig {
    const cfg = this.config();
    if (!cfg) throw new Error('Sentry is not connected yet. Pick an organization on the Sentry page.');
    if (!this.secrets.mcpSecret(SENTRY_TOKEN_SECRET)) throw new Error('No Sentry token set. Add SENTRY_ACCESS_TOKEN on the Sentry page.');
    return cfg;
  }

  /** API base for an org: its data region on sentry.io, or the self-hosted host. */
  private async baseFor(org: string): Promise<string> {
    const cfg = this.config();
    if (cfg?.org === org) return cfg.regionUrl ?? cfg.host;
    const host = normalizeHost(cfg?.host ?? SENTRY_CLOUD);
    return (await listOrgs(this.client, host)).find((o) => o.slug === org)?.regionUrl ?? host;
  }

  private async projectIds(slugs: string[]): Promise<string[]> {
    const all = await this.projects();
    const ids = slugs.map((s) => all.find((p) => p.slug === s)?.id).filter((x): x is string => !!x);
    if (!ids.length) throw new Error(`None of these Sentry projects exist: ${slugs.join(', ')}`);
    return ids;
  }
}

/** Status/level/assignee filters plus the human's own search, as one Sentry search string. */
export function buildQuery(q: SentryIssueQuery): string {
  const parts: string[] = [];
  const status = q.status ?? 'unresolved';
  if (status !== 'all') parts.push(`is:${status}`);
  if (q.level) parts.push(`level:${q.level}`);
  if (q.assigned === 'me') parts.push('assigned:me');
  if (q.assigned === 'unassigned') parts.push('is:unassigned');
  if (q.query?.trim()) parts.push(q.query.trim());
  return parts.join(' ');
}

async function listOrgs(client: SentryClient, host: string): Promise<SentryOrg[]> {
  const res = await client.get<Record<string, unknown>[]>(host, 'api/0/organizations/', { member: '1' });
  return res.data.map((o) => {
    const links = (o.links ?? {}) as Record<string, unknown>;
    return { slug: String(o.slug), name: String(o.name ?? o.slug), ...(typeof links.regionUrl === 'string' ? { regionUrl: links.regionUrl } : {}) };
  });
}

function normalizeHost(host: string) {
  const h = host.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(h)) throw new Error('Sentry URL must look like https://sentry.example.com');
  return h;
}

const enc = encodeURIComponent;
