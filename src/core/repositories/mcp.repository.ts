import fs from 'node:fs';
import { McpScope } from '../../shared/enums.js';
import { McpFileSchema } from '../../shared/schemas.js';
import type { McpServerEntry, McpTransportConfig } from '../../shared/types/index.js';
import { readJson, writeJson } from '../fs/json.js';

export type ScopedMcpEntry = McpServerEntry & { scope: McpScope };
type FileEntry = Record<string, unknown>;

/**
 * MCP servers AgentRoom gives its bots: `.agentroom/mcp.json` (team, committed) and
 * `runs/mcp.local.json` (this machine only). A personal server overrides a team one of the same name.
 */
export class McpRepository {
  constructor(private readonly files: Record<McpScope, string>) {}

  list(): ScopedMcpEntry[] {
    const byName = new Map<string, ScopedMcpEntry>();
    for (const scope of [McpScope.Team, McpScope.Personal]) {
      for (const e of this.read(scope)) byName.set(e.name, { ...e, scope });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): ScopedMcpEntry | undefined {
    return this.list().find((e) => e.name === name);
  }

  /** Add or replace a server in one scope (removing it from the other, so it lives in one place). */
  save(entry: McpServerEntry, scope: McpScope) {
    const other = scope === McpScope.Team ? McpScope.Personal : McpScope.Team;
    this.writeScope(other, this.read(other).filter((e) => e.name !== entry.name));
    const rest = this.read(scope).filter((e) => e.name !== entry.name);
    this.writeScope(scope, [...rest, entry]);
  }

  update(name: string, patch: Partial<Pick<McpServerEntry, 'enabled' | 'bots' | 'description'>>) {
    const cur = this.get(name);
    if (!cur) throw new Error(`No MCP server named "${name}"`);
    const { scope, ...entry } = cur;
    this.save({ ...entry, ...patch }, scope);
    return this.get(name)!;
  }

  remove(name: string) {
    for (const scope of [McpScope.Team, McpScope.Personal]) {
      const list = this.read(scope);
      if (list.some((e) => e.name === name)) this.writeScope(scope, list.filter((e) => e.name !== name));
    }
  }

  private read(scope: McpScope): McpServerEntry[] {
    const file = this.files[scope];
    if (!fs.existsSync(file)) return [];
    const parsed = McpFileSchema.safeParse(readJson(file, {}));
    if (!parsed.success) {
      console.error(`[agentroom] Ignoring invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return [];
    }
    return Object.entries(parsed.data.servers).map(([name, e]) => fromFile(name, e));
  }

  private writeScope(scope: McpScope, entries: McpServerEntry[]) {
    const file = this.files[scope];
    if (!entries.length && !fs.existsSync(file)) return;
    const servers: Record<string, FileEntry> = {};
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) servers[e.name] = toFile(e);
    writeJson(file, { servers });
  }
}

function fromFile(name: string, e: ReturnType<typeof McpFileSchema.parse>['servers'][string]): McpServerEntry {
  let config: McpTransportConfig;
  if (e.type === 'claudeai-proxy') config = { type: 'claudeai-proxy', url: e.url!, id: e.id! };
  else if (e.type === 'http' || e.type === 'sse') config = { type: e.type, url: e.url!, ...(e.headers ? { headers: e.headers } : {}) };
  else if (e.command) config = { type: 'stdio', command: e.command, ...(e.args ? { args: e.args } : {}), ...(e.env ? { env: e.env } : {}) };
  else config = { type: 'http', url: e.url!, ...(e.headers ? { headers: e.headers } : {}) };
  return {
    name,
    config,
    bots: e.bots,
    enabled: e.enabled,
    ...(e.description ? { description: e.description } : {}),
    ...(e.preset ? { preset: e.preset } : {}),
  };
}

/** Flat, hand-editable shape (same fields as Claude Code's .mcp.json). */
function toFile(e: McpServerEntry): FileEntry {
  return {
    ...(e.description ? { description: e.description } : {}),
    ...e.config,
    bots: e.bots,
    enabled: e.enabled,
    ...(e.preset ? { preset: e.preset } : {}),
  };
}
