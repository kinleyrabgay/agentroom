import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import type {
  Bot,
  Goal,
  GoalSource,
  HandoffResult,
  TrackerConfig,
  TrackerHandoffInput,
  TrackerId,
  TrackerIssueDetail,
  TrackerIssueFilters,
  TrackerIssuesPage,
  TrackerScope,
  TrackerStatus,
} from '../../../shared/types/index.js';
import { readJson, writeJson } from '../../../core/fs/json.js';
import type { SecretsStore } from '../../services/secrets.store.js';
import { resolveRepoFiles } from '../../services/repo-files.js';
import { resolveLead } from '../../workflow/roles.js';
import { HANDOFF_COMMENTS } from '../../config/constants.js';
import { JiraClient, jiraSite } from './jira-client.js';
import { LinearClient } from './linear-client.js';
import { TrackerError, type FetchLike, type TrackerClient } from './tracker-client.js';
import type { IssueSource, SourceIssue } from './issue-source.js';

export const TRACKER_LABEL: Record<TrackerId, string> = { linear: 'Linear', jira: 'Jira' };
const TITLE_MAX = 80;
const LIST_TTL_MS = 30_000;

const SyncSchema = z.object({
  onStart: z.string().min(1).nullable().default(null),
  onPr: z.string().min(1).nullable().default(null),
  commentPr: z.boolean().default(false),
});
const ConfigSchema = z.object({
  scopeId: z.string().min(1),
  scopeKey: z.string().min(1),
  scopeName: z.string().min(1),
  site: z.string().optional(),
  filter: z.string().max(500).optional(),
  sync: SyncSchema.prefault({}),
});

export interface TrackerDeps {
  tracker: TrackerId;
  /** `.agentroom/integrations/` (committed). */
  dir: string;
  root: string;
  secrets: SecretsStore;
  bots: () => Bot[];
  startGoal: (brief: string, title: string, sources: GoalSource[]) => Goal;
  sendToBot: (botId: string, text: string) => void;
  /** Issue text is written by anyone in the workspace: untrusted. */
  guard?: (text: string, source: string) => string;
  /** Tracker writes (status, comments) are audited with who/what caused them. */
  audit?: (summary: string, detail?: Record<string, unknown>) => void;
  fetch?: FetchLike;
  /** Test seam: build the client from credentials. */
  client?: (creds: Creds) => TrackerClient;
}

type Creds = { tracker: 'linear'; apiKey: string } | { tracker: 'jira'; site: string; email: string; token: string };

/**
 * One connected tracker (Linear or Jira): its committed setup, local credentials, issue list,
 * hand-offs to the team, and opt-in status sync back when a goal moves on.
 */
export class TrackerService {
  private cache: { key: string; at: number; page: TrackerIssuesPage } | null = null;

  constructor(private readonly deps: TrackerDeps) {}

  get id(): TrackerId {
    return this.deps.tracker;
  }
  get label() {
    return TRACKER_LABEL[this.deps.tracker];
  }
  private get file() {
    return path.join(this.deps.dir, `${this.deps.tracker}.json`);
  }

  config(): TrackerConfig | null {
    if (!fs.existsSync(this.file)) return null;
    const parsed = ConfigSchema.safeParse(readJson<unknown>(this.file, null));
    return parsed.success ? { tracker: this.deps.tracker, ...parsed.data } : null;
  }

  private creds(site = this.config()?.site): Creds | null {
    const s = this.deps.secrets.read();
    if (this.deps.tracker === 'linear') return s.linearApiKey ? { tracker: 'linear', apiKey: s.linearApiKey } : null;
    return s.jiraEmail && s.jiraToken && site ? { tracker: 'jira', site, email: s.jiraEmail, token: s.jiraToken } : null;
  }

  private hasToken() {
    const s = this.deps.secrets.read();
    return this.deps.tracker === 'linear' ? !!s.linearApiKey : !!(s.jiraEmail && s.jiraToken);
  }

  private makeClient(c: Creds): TrackerClient {
    if (this.deps.client) return this.deps.client(c);
    return c.tracker === 'linear' ? new LinearClient(c.apiKey, this.deps.fetch) : new JiraClient(c.site, c.email, c.token, this.deps.fetch);
  }

  private client(): TrackerClient {
    const c = this.creds();
    if (!c) throw new TrackerError(`${this.label} isn't connected on this machine.`, true);
    return this.makeClient(c);
  }

  private requireConfig(): TrackerConfig {
    const cfg = this.config();
    if (!cfg) throw new TrackerError(`Pick a ${this.deps.tracker === 'linear' ? 'team' : 'project'} for ${this.label} first.`);
    return cfg;
  }

  ready(): boolean {
    return !!this.config() && !!this.creds();
  }

  status(): TrackerStatus {
    return { tracker: this.deps.tracker, hasToken: this.hasToken(), config: this.config() };
  }

  /**
   * Check and store credentials (local secrets only). Jira also needs the site, which is committed
   * with the project config (it isn't secret) — until a project is picked it's kept in the secrets file.
   */
  async connect(input: { apiKey?: string; site?: string; email?: string; token?: string }): Promise<TrackerStatus & { scopes: TrackerScope[] }> {
    let creds: Creds;
    if (this.deps.tracker === 'linear') {
      const apiKey = String(input.apiKey ?? '').trim();
      if (!apiKey) throw new TrackerError('Paste a Linear API key.');
      creds = { tracker: 'linear', apiKey };
    } else {
      const site = jiraSite(String(input.site ?? this.config()?.site ?? ''));
      const email = String(input.email ?? '').trim();
      const token = String(input.token ?? '').trim();
      if (!email || !token) throw new TrackerError('Enter your Atlassian email and an API token.');
      creds = { tracker: 'jira', site, email, token };
    }
    const client = this.makeClient(creds);
    const viewer = await client.viewer();
    const scopes = await client.scopes();
    if (creds.tracker === 'linear') this.deps.secrets.setCredential('linearApiKey', creds.apiKey);
    else {
      this.deps.secrets.setCredential('jiraEmail', creds.email);
      this.deps.secrets.setCredential('jiraToken', creds.token);
      this.pendingSite = creds.site;
    }
    this.deps.audit?.(`${this.label} connected as ${viewer.name}`);
    return { ...this.status(), viewer, scopes };
  }

  /** Jira site entered while connecting, until a project is saved. */
  private pendingSite: string | null = null;

  async scopes(): Promise<TrackerScope[]> {
    const c = this.creds(this.config()?.site ?? this.pendingSite ?? undefined);
    if (!c) throw new TrackerError(`${this.label} isn't connected on this machine.`, true);
    return this.makeClient(c).scopes();
  }

  saveConfig(raw: unknown): TrackerStatus {
    const prev = this.config();
    const input = { ...(prev ?? {}), ...((raw ?? {}) as object) } as Record<string, unknown>;
    if (this.deps.tracker === 'jira') input.site = jiraSite(String(input.site ?? this.pendingSite ?? ''));
    const parsed = ConfigSchema.safeParse(input);
    if (!parsed.success) throw new TrackerError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    writeJson(this.file, parsed.data);
    this.cache = null;
    this.deps.audit?.(`${this.label} set to ${parsed.data.scopeName}`, { sync: parsed.data.sync });
    return this.status();
  }

  /** Forget the local credentials (the committed project config stays). */
  disconnect(): TrackerStatus {
    if (this.deps.tracker === 'linear') this.deps.secrets.setCredential('linearApiKey', '');
    else {
      this.deps.secrets.setCredential('jiraEmail', '');
      this.deps.secrets.setCredential('jiraToken', '');
    }
    this.cache = null;
    this.deps.audit?.(`${this.label} disconnected on this machine`);
    return this.status();
  }

  async issues(filters: TrackerIssueFilters = {}, opts: { refresh?: boolean } = {}): Promise<TrackerIssuesPage> {
    const cfg = this.requireConfig();
    const key = JSON.stringify(filters);
    if (!opts.refresh && this.cache && this.cache.key === key && Date.now() - this.cache.at < LIST_TTL_MS) return this.cache.page;
    const client = this.client();
    const [issues, states] = await Promise.all([client.issues(cfg.scopeId, filters, cfg.filter), client.states(cfg.scopeId)]);
    const page = { issues, states, fetchedAt: new Date().toISOString() };
    this.cache = { key, at: Date.now(), page };
    return page;
  }

  detail(idOrKey: string): Promise<TrackerIssueDetail> {
    return this.client().issue(idOrKey);
  }

  /** Hand issues to a bot: the lead starts a goal run, any other bot gets the brief. */
  async handoff(input: TrackerHandoffInput): Promise<HandoffResult> {
    const ids = [...new Set((input.issueIds ?? []).map(String))];
    if (!ids.length) throw new TrackerError('Select at least one issue.');
    const bots = this.deps.bots();
    const lead = resolveLead(bots);
    const botId = input.botId ?? lead?.id;
    const bot = bots.find((b) => b.id === botId);
    if (!bot) throw new TrackerError(botId ? `Unknown bot "${botId}".` : 'No Team Lead bot found.');
    const files = resolveRepoFiles(this.deps.root, input.files ?? []);
    const links = (input.links ?? []).map((l) => String(l).trim()).filter(Boolean);
    for (const l of links) if (!/^https?:\/\//i.test(l)) throw new TrackerError(`"${l}" isn't a link (http/https).`);

    const details = await Promise.all(ids.map((id) => this.detail(id)));
    const brief = buildTrackerBrief(this.label, details, input.note?.trim() ?? '', files, links, this.deps.guard);
    const sources: GoalSource[] = details.map(({ issue }) => ({ type: 'issue', tracker: this.deps.tracker, itemId: issue.id, key: issue.key, title: issue.title, url: issue.url }));
    if (bot.id === lead?.id) {
      const first = details[0]!.issue;
      const title = details.length === 1 ? `${first.key}: ${first.title}` : `${details.length} ${this.label} issues: ${first.key} …`;
      return { botId: bot.id, goal: this.deps.startGoal(brief, title.slice(0, TITLE_MAX), sources) };
    }
    this.deps.sendToBot(bot.id, brief);
    return { botId: bot.id };
  }

  /** Explicit, audited tracker writes. `by` names who/what caused it. */
  async moveTo(idOrKey: string, state: string, by: string) {
    const cfg = this.requireConfig();
    await this.client().moveTo(idOrKey, state, cfg.scopeId);
    this.cache = null;
    this.deps.audit?.(`${this.label}: moved ${idOrKey} to ${state}`, { by });
  }

  async comment(idOrKey: string, body: string, by: string) {
    await this.client().comment(idOrKey, body);
    this.deps.audit?.(`${this.label}: commented on ${idOrKey}`, { by });
  }

  /**
   * Status sync for goals that came from this tracker. Only runs what the committed `sync` rules
   * ask for (all off by default); failures are reported, never thrown.
   */
  async onGoalEvent(goal: Goal, event: 'started' | 'pr'): Promise<string[]> {
    const cfg = this.config();
    if (!cfg || !this.creds()) return [];
    const mine = goal.sources.filter((s): s is Extract<GoalSource, { type: 'issue' }> => s.type === 'issue' && s.tracker === this.deps.tracker);
    if (!mine.length) return [];
    const errors: string[] = [];
    const by = `sync rule (${goal.id})`;
    for (const s of mine) {
      try {
        if (event === 'started' && cfg.sync.onStart) await this.moveTo(s.itemId, cfg.sync.onStart, by);
        if (event === 'pr') {
          if (cfg.sync.commentPr && goal.pr) await this.comment(s.itemId, `AgentRoom opened a pull request for this: ${goal.pr.url}`, by);
          if (cfg.sync.onPr) await this.moveTo(s.itemId, cfg.sync.onPr, by);
        }
      } catch (err) {
        errors.push(`${s.key}: ${(err as Error).message}`);
      }
    }
    return errors;
  }

  /** This tracker as a generic issue source (triggers, chat intake). */
  asSource(): IssueSource {
    const toSource = (i: { id: string; key: string; title: string; url: string; state: { name: string } }): SourceIssue => ({
      source: this.deps.tracker,
      id: i.id,
      ref: i.key,
      title: i.title,
      url: i.url,
      state: i.state.name,
    });
    return {
      id: this.deps.tracker,
      label: this.label,
      ready: () => this.ready(),
      list: async () => (await this.issues({}, { refresh: true })).issues.map(toSource),
      matches: (ref) => {
        const key = this.config()?.scopeKey;
        return !!key && ref.toUpperCase().startsWith(`${key.toUpperCase()}-`);
      },
      find: async (ref) => toSource((await this.detail(ref)).issue),
      handoff: (input) => this.handoff({ issueIds: input.ids, ...(input.botId ? { botId: input.botId } : {}), ...(input.note ? { note: input.note } : {}) }),
      transition: (id, state) => this.moveTo(id, state, 'explicit action'),
      comment: (id, body) => this.comment(id, body, 'explicit action'),
    };
  }
}

/** Markdown brief: each issue (body + recent comments, as untrusted data), then the human's notes. */
export function buildTrackerBrief(
  label: string,
  details: TrackerIssueDetail[],
  note: string,
  files: string[],
  links: string[],
  guard: (text: string, source: string) => string = (t) => t,
): string {
  const parts = [details.length === 1 ? `Work on this ${label} issue.` : `Work on these ${details.length} ${label} issues.`];
  for (const d of details) {
    const { issue } = d;
    const lines = [`### ${issue.key} ${issue.title}`, issue.url];
    const meta = [
      `State: ${issue.state.name}`,
      issue.type ? `Type: ${issue.type}` : '',
      issue.priority ? `Priority: ${issue.priority.label}` : '',
      issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : '',
      issue.assignee ? `Assignee: ${issue.assignee.name}` : '',
    ].filter(Boolean);
    lines.push(meta.join(' · '));
    const content = [d.description.trim() || '_No description._'];
    const comments = d.comments.slice(-HANDOFF_COMMENTS);
    if (comments.length) {
      content.push('', '**Recent comments**');
      for (const c of comments) content.push(`- ${c.author} (${c.createdAt.slice(0, 10)}): ${c.body.trim().replace(/\n+/g, ' ')}`);
    }
    lines.push('', guard(content.join('\n'), `${label} ${issue.key}`));
    parts.push(lines.join('\n'));
  }
  if (note) parts.push(`## Notes from the human\n${note}`);
  if (files.length) parts.push(`## Files to read\n${files.map((f) => `- \`${f}\``).join('\n')}`);
  if (links.length) parts.push(`## Links\n${links.map((l) => `- ${l}`).join('\n')}`);
  return parts.join('\n\n');
}
