import type { Hono } from 'hono';
import { AuditKind, McpScope } from '../../../shared/enums.js';
import type { McpTransportConfig } from '../../../shared/types/index.js';
import type { HumanAudit } from '../../services/audit.service.js';
import type { McpService } from '../../services/mcp/mcp.service.js';
import { MCP_PRESETS } from '../../services/mcp/presets.js';
import { body, respond } from '../respond.js';

const scopeOf = (v: unknown): McpScope => (v === McpScope.Team ? McpScope.Team : McpScope.Personal);

/** External MCP servers: status, add/remove, which bots get them, secrets (write-only) and browser sign-in. */
export function mcpRoutes(app: Hono, mcp: McpService, audit: HumanAudit) {
  app.get('/mcp', (c) => c.json(mcp.snapshot()));
  app.get('/mcp/presets', (c) => c.json(MCP_PRESETS));
  app.post('/mcp/refresh', (c) => respond(c, () => mcp.refresh().then(() => mcp.snapshot())));

  app.post('/mcp/servers', async (c) => {
    const b = await body<{ name: string; config: McpTransportConfig; scope?: string; bots?: string[]; description?: string; preset?: string; secrets?: Record<string, string> }>(c);
    return respond(c, () => {
      const entry = mcp.add({ ...b, scope: scopeOf(b.scope) });
      // Secret values are never logged.
      audit(AuditKind.Settings, `MCP server added: ${entry.name}`, { detail: { name: entry.name, type: entry.config.type, scope: scopeOf(b.scope) } });
      return entry;
    });
  });

  app.post('/mcp/import', async (c) => {
    const { name } = await body<{ name: string }>(c);
    return respond(c, () => {
      const entry = mcp.importAvailable(name);
      audit(AuditKind.Settings, `MCP server added from Claude Code: ${entry.name}`, { detail: { source: name, name: entry.name } });
      return entry;
    });
  });

  app.patch('/mcp/servers/:name', async (c) => {
    const name = c.req.param('name');
    const b = await body<{ enabled?: boolean; bots?: string[]; scope?: string }>(c);
    return respond(c, () => {
      const entry = mcp.update(name, { ...(b.enabled !== undefined ? { enabled: !!b.enabled } : {}), ...(b.bots ? { bots: b.bots } : {}), ...(b.scope ? { scope: scopeOf(b.scope) } : {}) });
      audit(AuditKind.Settings, `MCP server ${name} changed: ${Object.keys(b).join(', ')}`, { detail: { name, ...b } });
      return entry;
    });
  });

  app.delete('/mcp/servers/:name', (c) => {
    const name = c.req.param('name');
    return respond(c, () => {
      mcp.remove(name);
      audit(AuditKind.Settings, `MCP server removed: ${name}`, { detail: { name } });
    });
  });

  app.put('/mcp/servers/:name/secrets', async (c) => {
    const name = c.req.param('name');
    const values = await body<Record<string, string>>(c);
    return respond(c, () => {
      mcp.setSecrets(name, values);
      audit(AuditKind.Settings, `MCP secrets updated for ${name}: ${Object.keys(values).join(', ')}`, { detail: { name, keys: Object.keys(values) } });
    });
  });

  app.post('/mcp/servers/:name/sign-in', (c) => respond(c, () => mcp.signIn(c.req.param('name'))));
}
