import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { WorkspaceService } from '../../workspaces/workspace.service.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { body, respond } from '../respond.js';

/** Multi-repo workspaces: the workspace (null in single-project mode), its merged map, and syncing every repo. */
export function workspaceRoutes(app: Hono, workspace: WorkspaceService, audit: HumanAudit) {
  app.get('/workspace', (c) => respond(c, () => workspace.view()));
  app.get('/workspace/graph', (c) => respond(c, () => workspace.graph()));
  app.get('/workspace/edges', (c) => respond(c, () => workspace.crossEdges()));
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
