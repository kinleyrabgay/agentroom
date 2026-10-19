import type { Hono } from 'hono';
import type { HandoffInput } from '../../../shared/types/index.js';
import type { GithubProjectService } from '../../integrations/github/github-project.service.js';
import type { HandoffService } from '../../integrations/github/handoff.service.js';
import { searchRepoFiles } from '../../services/repo-files.js';
import { AuditKind } from '../../../shared/enums.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { body, respond } from '../respond.js';

/** GitHub Board: connect a project, read cards (cache-first), assign yourself, hand cards to bots. */
export function githubRoutes(app: Hono, github: GithubProjectService, handoff: HandoffService, root: string, audit: HumanAudit) {
  app.get('/github', (c) => c.json({ project: github.config() }));
  app.put('/github', async (c) => {
    const { url } = await body<{ url?: string }>(c);
    return respond(c, async () => {
      const project = await github.connect(String(url ?? ''));
      audit(AuditKind.Settings, `Connected GitHub project ${project.url}`);
      return project;
    });
  });
  app.delete('/github', (c) =>
    respond(c, () => {
      github.disconnect();
      audit(AuditKind.Settings, 'Disconnected GitHub project');
    }),
  );
  app.patch('/github', async (c) => {
    const { hiddenColumns } = await body<{ hiddenColumns?: string[] }>(c);
    return respond(c, () => github.setHiddenColumns(hiddenColumns ?? []));
  });
  app.post('/github/sync-columns', (c) => respond(c, () => github.syncColumns()));
  app.get('/github/items', (c) => respond(c, () => github.board({ refresh: c.req.query('refresh') === '1' })));
  app.get('/github/items/:id', (c) => respond(c, () => github.itemDetail(c.req.param('id'))));
  app.post('/github/items/:id/assign', async (c) => {
    const { assign } = await body<{ assign?: boolean }>(c);
    const add = assign !== false;
    return respond(c, async () => {
      const item = await github.setAssigned(c.req.param('id'), add);
      const ref = item.repo && item.number ? `${item.repo}#${item.number}` : item.title;
      audit(AuditKind.GithubWrite, `${add ? 'Assigned' : 'Unassigned'} self on ${ref}`, { detail: { itemId: item.id, url: item.url } });
      return item;
    });
  });
  app.post('/github/handoff', async (c) => {
    const input = await body<HandoffInput>(c);
    return respond(c, async () => {
      const result = await handoff.handoff(input);
      audit(AuditKind.Handoff, `Handed ${input.itemIds?.length ?? 0} card(s) to ${result.botId}${result.goal ? ` → ${result.goal.id}` : ''}`, {
        botId: result.botId,
        ...(result.goal ? { goalId: result.goal.id } : {}),
        detail: { itemIds: input.itemIds, files: input.files, links: input.links },
      });
      return result;
    });
  });

  app.get('/files', (c) => {
    const limit = Number(c.req.query('limit') ?? 30) || 30;
    return respond(c, () => searchRepoFiles(root, c.req.query('q') ?? '', limit));
  });
}
