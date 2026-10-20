import type { McpServerConfig, McpServerStatus, Query } from '@anthropic-ai/claude-agent-sdk';
import { MCP_ALL_BOTS } from '../../../shared/constants.js';
import { McpScope, McpStatus, StateType } from '../../../shared/enums.js';
import type {
  Bot,
  McpAvailable,
  McpServerEntry,
  McpServerState,
  McpSnapshot,
  McpTool,
  McpTransportConfig,
} from '../../../shared/types/index.js';
import { MCP_NAME } from '../../../shared/schemas.js';
import type { McpRepository } from '../../../core/repositories/mcp.repository.js';
import { withIdleSession } from '../../providers/claude/idle-session.js';
import type { Hub } from '../../realtime/hub.js';
import type { SecretsStore } from '../secrets.store.js';
import { resolveConfig, safeName, secretRefs, toolPrefix } from './resolve.js';

/** How long a status check may take (servers connect in parallel; slow ones report "pending"). */
const PROBE_MS = 20_000;
/** How long a browser sign-in may take before the waiting session is closed. */
const SIGN_IN_MS = 5 * 60_000;
const POLL_MS = 1_500;
/** Re-check now and then: tokens expire, servers go down. */
const RECHECK_MS = 15 * 60_000;
/** Where claude.ai connectors are signed in. */
const CLAUDE_AI_CONNECTORS = 'https://claude.ai/settings/connectors';

interface Live {
  status: McpStatus;
  error?: string;
  tools: McpTool[];
  server?: { name: string; version: string };
}

export interface McpServiceDeps {
  repo: McpRepository;
  secrets: SecretsStore;
  hub: Hub;
  cwd: string;
  bots: () => Bot[];
  /**
   * Workspaces: team servers committed in the other repos. Offered under "Found in…", never
   * enabled on their own: the owner adds the ones they want (as Personal).
   */
  repoServers?: () => { repo: string; servers: McpServerEntry[] }[];
}

/** Name of a server from another workspace repo in the "available" list. */
const repoServerName = (repo: string, name: string) => `${repo}/${name}`;

export type SignInResult = { connected: true } | { connected: false; url: string; external?: boolean };

/**
 * External MCP servers for the bots: which are configured, whether they connect, and what each bot gets.
 * Bots run with `strictMcpConfig`, so they only see servers added here (never everything in Claude Code).
 */
export class McpService {
  private live = new Map<string, Live>();
  private available: McpAvailable[] = [];
  /** Full configs of servers found in Claude Code (for import); never sent to the UI. */
  private availableConfigs = new Map<string, McpServerStatus['config']>();
  private checkedAt: string | null = null;
  private checking: Promise<void> | null = null;
  private signingIn: string | undefined;
  private timer?: NodeJS.Timeout;

  constructor(private readonly deps: McpServiceDeps) {}

  start() {
    setTimeout(() => void this.refresh(), 1500).unref();
    this.timer = setInterval(() => void this.refresh(), RECHECK_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  snapshot(): McpSnapshot {
    const servers: McpServerState[] = this.deps.repo.list().map((e) => {
      const secrets = secretRefs(e.config);
      const resolved = this.resolve(e.config);
      const live = this.live.get(e.name);
      const status = !e.enabled
        ? McpStatus.Disabled
        : resolved.missing.length
          ? McpStatus.MissingSecret
          : (live?.status ?? McpStatus.Unknown);
      return {
        ...e,
        status,
        tools: live?.tools ?? [],
        missingSecrets: resolved.missing,
        secrets,
        ...(live?.error && status === McpStatus.Failed ? { error: live.error } : {}),
        ...(live?.server ? { server: live.server } : {}),
      };
    });
    const added = new Map(servers.map((s) => [configKey(s.config), s.name]));
    const available = this.available.map((a) => {
      const c = this.availableConfigs.get(a.name);
      const name = c ? added.get(configKey(c as McpTransportConfig)) : undefined;
      return name ? { ...a, added: name } : a;
    });
    for (const { repo, entry } of this.fromRepos()) {
      const c = entry.config as { type?: string; url?: string; command?: string; args?: string[] };
      const name = added.get(configKey(entry.config));
      available.push({
        name: repoServerName(repo, entry.name),
        source: `workspace:${repo}`,
        status: McpStatus.Unknown,
        type: c.type ?? 'stdio',
        ...(c.url ? { url: c.url } : {}),
        ...(c.command ? { command: [c.command, ...(c.args ?? [])].join(' ') } : {}),
        toolCount: 0,
        repo,
        ...(name ? { added: name } : {}),
      });
    }
    return {
      servers,
      available,
      checkedAt: this.checkedAt,
      checking: !!this.checking,
      ...(this.signingIn ? { signingIn: this.signingIn } : {}),
    };
  }

  push() {
    this.deps.hub.state({ type: StateType.Mcp, mcp: this.snapshot() });
  }

  /** SDK configs for one bot's run: enabled, allowed for the bot, and with every secret set. */
  forBot(bot: Bot): Record<string, McpServerConfig> {
    const out: Record<string, McpServerConfig> = {};
    for (const e of this.deps.repo.list()) {
      if (!e.enabled || !allows(e, bot.id)) continue;
      const r = this.resolve(e.config);
      if (r.config) out[e.name] = r.config;
    }
    return out;
  }

  /** The bot gets an enabled, ready server matching `hint` (its name, preset or URL), e.g. "sentry". */
  hasServerFor(bot: Bot, hint: string): boolean {
    return this.deps.repo
      .list()
      .some(
        (e) =>
          e.enabled &&
          allows(e, bot.id) &&
          !this.resolve(e.config).missing.length &&
          [e.name, e.preset ?? '', 'url' in e.config ? e.config.url : 'command' in e.config ? (e.config.args ?? []).join(' ') : ''].some((v) => v.toLowerCase().includes(hint)),
      );
  }

  /** One line per server a bot can use, for its system prompt. */
  describeFor(bot: Bot): string[] {
    return this.deps.repo
      .list()
      .filter((e) => e.enabled && allows(e, bot.id) && !this.resolve(e.config).missing.length)
      .map((e) => `- ${e.name}${e.description ? `: ${e.description}` : ''} (tools: ${toolPrefix(e.name)}*)`);
  }

  /** The server says the tool only reads (used to skip approval under ask-writes). */
  isReadOnlyTool(fullName: string): boolean {
    for (const [name, live] of this.live) {
      const prefix = toolPrefix(name);
      if (fullName.startsWith(prefix)) return !!live.tools.find((t) => t.name === fullName.slice(prefix.length))?.readOnly;
    }
    return false;
  }

  /** The configured server a tool belongs to, e.g. `mcp__sentry__find_issues` → "sentry". */
  serverOf(fullName: string): string | undefined {
    return this.deps.repo.list().find((e) => fullName.startsWith(toolPrefix(e.name)))?.name;
  }

  /** Check every server again (one at a time; concurrent calls share the run). */
  refresh(): Promise<void> {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      this.push();
      await Promise.all([this.probeConfigured(), this.discover()]);
      this.checkedAt = new Date().toISOString();
    })()
      .catch((err) => console.error('[agentroom] MCP status check failed:', (err as Error).message))
      .finally(() => {
        this.checking = null;
        this.push();
      });
    return this.checking;
  }

  add(input: { name: string; config: McpTransportConfig; scope: McpScope; bots?: string[]; description?: string; preset?: string; secrets?: Record<string, string> }) {
    if (!MCP_NAME.test(input.name)) throw new Error('Name: letters, digits, - and _ only');
    if (this.deps.repo.get(input.name)) throw new Error(`A server named "${input.name}" already exists`);
    if (input.scope === McpScope.Team && input.config.type === 'claudeai-proxy') throw new Error('claude.ai connectors are personal; add it as Personal');
    validateConfig(input.config);
    if (input.secrets && Object.keys(input.secrets).length) this.deps.secrets.setMcpSecrets(input.secrets);
    const entry: McpServerEntry = {
      name: input.name,
      config: input.config,
      bots: input.bots?.length ? input.bots : [MCP_ALL_BOTS],
      enabled: true,
      ...(input.description ? { description: input.description } : {}),
      ...(input.preset ? { preset: input.preset } : {}),
    };
    this.deps.repo.save(entry, input.scope);
    void this.refresh();
    return entry;
  }

  update(name: string, patch: { enabled?: boolean; bots?: string[]; scope?: McpScope }) {
    const cur = this.deps.repo.get(name);
    if (!cur) throw new Error(`No MCP server named "${name}"`);
    if (patch.scope === McpScope.Team && cur.config.type === 'claudeai-proxy') throw new Error('claude.ai connectors are personal and cannot be shared with the team');
    if (patch.bots && !patch.bots.length) throw new Error('Pick at least one bot, or turn the server off');
    const { scope, ...entry } = cur;
    this.deps.repo.save({ ...entry, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.bots ? { bots: patch.bots } : {}) }, patch.scope ?? scope);
    if (patch.enabled !== undefined) void this.refresh();
    else this.push();
    return this.deps.repo.get(name)!;
  }

  remove(name: string) {
    this.deps.repo.remove(name);
    this.live.delete(name);
    this.push();
  }

  setSecrets(name: string, values: Record<string, string>) {
    const cur = this.deps.repo.get(name);
    if (!cur) throw new Error(`No MCP server named "${name}"`);
    const allowed = new Set(secretRefs(cur.config));
    for (const k of Object.keys(values)) if (!allowed.has(k)) throw new Error(`"${name}" does not use a secret named ${k}`);
    this.deps.secrets.setMcpSecrets(values);
    void this.refresh();
  }

  /**
   * Add a server found in Claude Code. Header/env values move into local secrets (so nothing sensitive
   * lands in mcp.json); it is added as Personal, and can be shared with the team afterwards.
   */
  importAvailable(sourceName: string): McpServerEntry {
    const fromRepo = this.fromRepos().find(({ repo, entry }) => repoServerName(repo, entry.name) === sourceName);
    if (fromRepo) {
      // Copied as-is: `${secret:NAME}` references stay references; you set the values here.
      let name = safeName(fromRepo.entry.name);
      for (let i = 2; this.deps.repo.get(name); i++) name = `${safeName(fromRepo.entry.name)}-${i}`;
      return this.add({ name, config: fromRepo.entry.config, scope: McpScope.Personal, description: fromRepo.entry.description ?? `From the ${fromRepo.repo} repo` });
    }
    const raw = this.availableConfigs.get(sourceName);
    if (!raw) throw new Error(`"${sourceName}" was not found in Claude Code. Refresh and try again.`);
    let name = safeName(sourceName);
    for (let i = 2; this.deps.repo.get(name); i++) name = `${safeName(sourceName)}-${i}`;
    const prefix = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const secrets: Record<string, string> = {};
    const toSecrets = (o?: Record<string, string>) =>
      o
        ? Object.fromEntries(
            Object.entries(o).map(([k, v]) => {
              const key = `${prefix}_${k.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`.replace(/^([^A-Z])/, 'S_$1').slice(0, 64);
              secrets[key] = v;
              return [k, `\${secret:${key}}`];
            }),
          )
        : undefined;

    const c = raw as Record<string, unknown> & { type?: string };
    let config: McpTransportConfig;
    if (c.type === 'claudeai-proxy') config = { type: 'claudeai-proxy', url: String(c.url), id: String(c.id) };
    else if (c.type === 'http' || c.type === 'sse') {
      const headers = toSecrets(c.headers as Record<string, string> | undefined);
      config = { type: c.type, url: String(c.url), ...(headers ? { headers } : {}) };
    } else if (typeof c.command === 'string') {
      const env = toSecrets(c.env as Record<string, string> | undefined);
      config = { type: 'stdio', command: c.command, ...(Array.isArray(c.args) ? { args: c.args.map(String) } : {}), ...(env ? { env } : {}) };
    } else throw new Error(`"${sourceName}" uses a connection type AgentRoom can't run (${c.type ?? 'unknown'})`);

    return this.add({ name, config, scope: McpScope.Personal, secrets, description: `From Claude Code (${sourceName})` });
  }

  /**
   * Start a browser sign-in (OAuth) for a server. Claude Code listens for the callback on localhost;
   * a session stays open until the sign-in completes (or times out), then statuses refresh.
   */
  async signIn(name: string): Promise<SignInResult> {
    const entry = this.deps.repo.get(name);
    if (!entry) throw new Error(`No MCP server named "${name}"`);
    if (entry.config.type === 'claudeai-proxy') return { connected: false, url: CLAUDE_AI_CONNECTORS, external: true };
    const r = this.resolve(entry.config);
    if (!r.config) throw new Error(`Set ${r.missing.join(', ')} first`);
    if (this.signingIn) throw new Error(`Already waiting for the ${this.signingIn} sign-in. Finish it in the browser first.`);

    return new Promise<SignInResult>((resolve, reject) => {
      let settled = false;
      const finish = (v: SignInResult | Error) => {
        if (settled) return;
        settled = true;
        if (v instanceof Error) reject(v);
        else resolve(v);
      };
      this.signingIn = name;
      this.push();
      void withIdleSession(
        this.deps.cwd,
        SIGN_IN_MS,
        async (q) => {
          await waitSettled(q, PROBE_MS);
          const res = (await (q as Query & { mcpAuthenticate(n: string): Promise<{ authUrl?: string; requiresUserAction?: boolean }> }).mcpAuthenticate(name)) ?? {};
          if (!res.authUrl || res.requiresUserAction === false) {
            finish({ connected: true });
            return;
          }
          finish({ connected: false, url: res.authUrl });
          // Keep the session (and its localhost callback) alive until the browser comes back.
          const until = Date.now() + SIGN_IN_MS - POLL_MS;
          while (Date.now() < until) {
            await sleep(POLL_MS);
            const s = (await q.mcpServerStatus()).find((x) => x.name === name);
            if (s?.status === 'connected') return;
          }
        },
        { strictMcpConfig: true, mcpServers: { [name]: r.config } },
      )
        .catch((err) => finish(err instanceof Error ? err : new Error(String(err))))
        .finally(() => {
          this.signingIn = undefined;
          void this.refresh();
        });
    });
  }

  private resolve(config: McpTransportConfig) {
    return resolveConfig(config, (n) => this.deps.secrets.mcpSecret(n));
  }

  /** Status of AgentRoom's own servers, exactly as bots will get them (strict config). */
  private async probeConfigured() {
    const servers: Record<string, McpServerConfig> = {};
    for (const e of this.deps.repo.list()) {
      if (!e.enabled) continue;
      const r = this.resolve(e.config);
      if (r.config) servers[e.name] = r.config;
    }
    const names = new Set(this.deps.repo.list().map((e) => e.name));
    for (const n of this.live.keys()) if (!names.has(n)) this.live.delete(n);
    if (!Object.keys(servers).length) return;
    try {
      const statuses = await withIdleSession(this.deps.cwd, PROBE_MS + 5_000, (q) => waitSettled(q, PROBE_MS), {
        strictMcpConfig: true,
        mcpServers: servers,
      });
      for (const s of statuses) if (names.has(s.name)) this.live.set(s.name, toLive(s));
    } catch (err) {
      for (const n of Object.keys(servers)) this.live.set(n, { status: McpStatus.Failed, error: (err as Error).message, tools: [] });
    }
  }

  /** Team servers of the workspace's other repos (unreadable ones are skipped). */
  private fromRepos(): { repo: string; entry: McpServerEntry }[] {
    try {
      return (this.deps.repoServers?.() ?? []).flatMap(({ repo, servers }) => servers.filter((e) => e.config.type !== 'claudeai-proxy').map((entry) => ({ repo, entry })));
    } catch {
      return [];
    }
  }

  /** What's set up in Claude Code for this repo and user (claude.ai connectors, user/project/local, plugins). */
  private async discover() {
    try {
      const statuses = await withIdleSession(this.deps.cwd, PROBE_MS + 5_000, (q) => waitSettled(q, PROBE_MS), {
        settingSources: ['user', 'project', 'local'],
      });
      this.availableConfigs.clear();
      this.available = statuses
        .filter((s) => s.config?.type !== 'sdk')
        .map((s) => {
          this.availableConfigs.set(s.name, s.config);
          const c = s.config as { type?: string; url?: string } | undefined;
          return {
            name: s.name,
            source: s.source ?? s.scope ?? 'unknown',
            status: toStatus(s.status),
            type: c?.type ?? 'stdio',
            ...(c?.url ? { url: c.url } : {}),
            toolCount: s.tools?.length ?? 0,
          };
        })
        .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
    } catch (err) {
      console.error('[agentroom] Could not list Claude Code MCP servers:', (err as Error).message);
    }
  }
}

function allows(e: McpServerEntry, botId: string) {
  return e.bots.includes(MCP_ALL_BOTS) || e.bots.includes(botId);
}

/** Poll until no server is still connecting (or the time is up). */
async function waitSettled(q: Query, ms: number): Promise<McpServerStatus[]> {
  const until = Date.now() + ms;
  let statuses = await q.mcpServerStatus();
  while (statuses.some((s) => s.status === 'pending') && Date.now() < until) {
    await sleep(500);
    statuses = await q.mcpServerStatus();
  }
  return statuses;
}

function toLive(s: McpServerStatus): Live {
  return {
    status: toStatus(s.status),
    ...(s.error ? { error: s.error } : {}),
    tools: (s.tools ?? []).map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description.split('\n')[0]!.slice(0, 200) } : {}),
      ...(t.annotations?.readOnly ? { readOnly: true } : {}),
    })),
    ...(s.serverInfo ? { server: s.serverInfo } : {}),
  };
}

function toStatus(s: McpServerStatus['status']): McpStatus {
  switch (s) {
    case 'connected':
      return McpStatus.Connected;
    case 'needs-auth':
      return McpStatus.NeedsAuth;
    case 'failed':
      return McpStatus.Failed;
    case 'disabled':
      return McpStatus.Disabled;
    default:
      return McpStatus.Pending;
  }
}

/** Identity of a server's endpoint, to tell whether a Claude Code server is already added. */
function configKey(c: McpTransportConfig | { type?: string; url?: string; command?: string; args?: string[] }) {
  const x = c as { type?: string; url?: string; command?: string; args?: string[] };
  return x.url ? `url:${x.url}` : `cmd:${x.command} ${(x.args ?? []).join(' ')}`;
}

function validateConfig(c: McpTransportConfig) {
  if (c.type === 'stdio') {
    if (!c.command?.trim()) throw new Error('Command is required');
    return;
  }
  if (c.type === 'claudeai-proxy') return;
  if (!/^https?:\/\/\S+$/.test(c.url ?? '')) throw new Error('URL must start with http:// or https://');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
