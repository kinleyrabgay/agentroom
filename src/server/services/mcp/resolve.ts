import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { McpTransportConfig } from '../../../shared/types/index.js';

const REF = /\$\{(secret|env):([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** `${secret:NAME}` names referenced anywhere in a server's config. */
export function secretRefs(config: McpTransportConfig): string[] {
  const names = new Set<string>();
  for (const v of stringsOf(config)) for (const m of v.matchAll(REF)) if (m[1] === 'secret') names.add(m[2]!);
  return [...names];
}

/**
 * Substitute `${secret:NAME}` / `${env:NAME}` and turn the entry into an SDK MCP config.
 * Returns the names that couldn't be resolved instead (the server isn't started then).
 */
export function resolveConfig(
  config: McpTransportConfig,
  secret: (name: string) => string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { config: McpServerConfig; missing: [] } | { config: null; missing: string[] } {
  const missing = new Set<string>();
  const sub = (v: string) =>
    v.replace(REF, (_, kind: string, name: string) => {
      const val = kind === 'secret' ? secret(name) : env[name];
      if (val === undefined || val === '') missing.add(kind === 'secret' ? name : `env:${name}`);
      return val ?? '';
    });
  const map = (o?: Record<string, string>) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sub(v)])) : undefined);

  let out: McpServerConfig;
  if (config.type === 'stdio') {
    const e = map(config.env);
    out = { type: 'stdio', command: sub(config.command), ...(config.args ? { args: config.args.map(sub) } : {}), ...(e ? { env: e } : {}) };
  } else if (config.type === 'claudeai-proxy') {
    // Not in the SDK's public union, but the CLI accepts it (a claude.ai connector).
    out = { type: 'claudeai-proxy', url: config.url, id: config.id } as unknown as McpServerConfig;
  } else {
    const h = map(config.headers);
    out = { type: config.type, url: sub(config.url), ...(h ? { headers: h } : {}) };
  }
  return missing.size ? { config: null, missing: [...missing] } : { config: out, missing: [] };
}

/** The SDK names tools `mcp__<server>__<tool>`, with characters outside [a-zA-Z0-9_-] replaced by `_`. */
export function toolPrefix(server: string) {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, '_')}__`;
}

/** A name that works as an mcp.json key, e.g. "claude.ai Linear" → "linear". */
export function safeName(name: string) {
  return (
    name
      .replace(/^claude\.ai\s+/i, '')
      .replace(/^plugin:[^:]+:/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'server'
  );
}

function stringsOf(c: McpTransportConfig): string[] {
  if (c.type === 'stdio') return [c.command, ...(c.args ?? []), ...Object.values(c.env ?? {})];
  if (c.type === 'claudeai-proxy') return [];
  return [c.url, ...Object.values(c.headers ?? {})];
}
