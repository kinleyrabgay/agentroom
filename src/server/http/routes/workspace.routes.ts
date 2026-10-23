import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { WorkspaceService } from '../../workspaces/workspace.service.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { body, respond } from '../respond.js';

/** Multi-repo workspaces: the workspace (null in single-project mode), its merged map, and syncing every repo. */
export function workspaceRoutes(app: Hono, workspace: WorkspaceService, audit: HumanAudit, humanName: () => string = () => 'human') {
  // `null` outside a workspace (respond() would turn it into `{ ok: true }`, which the UI reads as a workspace).
  app.get('/workspace', (c) => c.json(workspace.view() ?? null));
  app.get('/workspace/graph', (c) => respond(c, () => workspace.graph({ hidden: c.req.query('hidden') === '1' })));
  app.get('/workspace/edges', (c) => respond(c, () => workspace.crossEdges({ hidden: c.req.query('hidden') === '1' })));

  // ----- Settings → Workspace (owner only: the team room's access policy denies members) -----
  app.get('/workspaces', (c) => respond(c, () => workspace.workspaces()));
  app.post('/workspaces', async (c) => {
    const { name, paths, primary } = await body<{ name?: string; paths?: string[]; primary?: string }>(c);
    return respond(c, () => {
      const created = workspace.create(String(name ?? ''), Array.isArray(paths) ? paths : [], primary);
      audit(AuditKind.Settings, `Created workspace ${created.name} (${created.repos.map((r) => r.id).join(', ')})`);
      return { workspace: created, start: `agentroom start --workspace ${created.name}` };
    });
  });
  app.patch('/workspaces/:name?', async (c) => {
    const change = await body<{ add?: string; remove?: string; primary?: string; repo?: string; devCommand?: string; url?: string }>(c);
    return respond(c, () => {
      const next = workspace.edit(c.req.param('name'), change);
      const what = change.add ? `added ${change.add}` : change.remove ? `removed ${change.remove}` : change.primary ? `primary is now ${change.primary}` : `app settings of ${change.repo}`;
      audit(AuditKind.Settings, `Workspace ${next.name}: ${what}`);
      return { workspace: next, view: workspace.view() };
    });
  });

  // ----- cross-repo links: confirm, hide, add (committed in the primary repo) -----
  app.post('/workspace/links', async (c) => {
    const { key, action } = await body<{ key?: string; action?: 'confirm' | 'hide' | 'reset' }>(c);
    return respond(c, () => {
      const out = workspace.decideLink(String(key ?? ''), action ?? 'confirm');
      audit(AuditKind.Settings, `Workspace link ${action ?? 'confirm'}: ${key}`);
      return out;
    });
  });
  app.post('/workspace/links/manual', async (c) => {
    const input = await body<{ fromRepo?: string; from?: string; toRepo?: string; to?: string; note?: string }>(c);
    return respond(c, () => {
      // The links file is committed: keep the name, not the email.
      const out = workspace.addLink(input, humanName().replace(/\s*<[^>]*>\s*$/, ''));
      audit(AuditKind.Settings, `Workspace link added: ${input.fromRepo}:${input.from} → ${input.toRepo}:${input.to}`);
      return out;
    });
  });
  app.delete('/workspace/links/manual', async (c) => {
    const key = c.req.query('key') ?? '';
    return respond(c, () => {
      const out = workspace.removeLink(key);
      audit(AuditKind.Settings, `Workspace link removed: ${key}`);
      return out;
    });
  });
  app.post('/workspace/sync', async (c) => {
    const { cards } = await body<{ cards?: boolean }>(c);
    return respond(c, () => {
      const repos = workspace.registry.list();
      audit(AuditKind.Settings, `Workspace context sync started for ${repos.map((r) => r.id).join(', ')}${cards ? ' (with cards)' : ''}`);
      // Runs in the background, repo by repo; each repo's progress arrives over the live channel.
      void (async () => {
        for (const r of repos) await workspace.context(r.id).sync({ cards: cards === true }).catch(() => {});
      })();
      return workspace.view();
    });
  });
}
