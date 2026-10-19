import type { Hono } from 'hono';
import type { HandoffInput } from '../../../shared/types/index.js';
import type { GithubProjectService } from '../../integrations/github/github-project.service.js';
import type { HandoffService } from '../../integrations/github/handoff.service.js';
import { searchRepoFiles } from '../../services/repo-files.js';
import { body, respond } from '../respond.js';

/** GitHub Board: connect a project, read cards (cache-first), assign yourself, hand cards to bots. */
export function githubRoutes(app: Hono, github: GithubProjectService, handoff: HandoffService, root: string) {
  app.get('/github', (c) => c.json({ project: github.config() }));
  app.put('/github', async (c) => {
    const { url } = await body<{ url?: string }>(c);
    return respond(c, () => github.connect(String(url ?? '')));
  });
  app.delete('/github', (c) => respond(c, () => github.disconnect()));
  app.patch('/github', async (c) => {
    const { hiddenColumns } = await body<{ hiddenColumns?: string[] }>(c);
    return respond(c, () => github.setHiddenColumns(hiddenColumns ?? []));
  });
  app.post('/github/sync-columns', (c) => respond(c, () => github.syncColumns()));
  app.get('/github/items', (c) => respond(c, () => github.board({ refresh: c.req.query('refresh') === '1' })));
  app.get('/github/items/:id', (c) => respond(c, () => github.itemDetail(c.req.param('id'))));
  app.post('/github/items/:id/assign', async (c) => {
    const { assign } = await body<{ assign?: boolean }>(c);
    return respond(c, () => github.setAssigned(c.req.param('id'), assign !== false));
  });
  app.post('/github/handoff', async (c) => {
    const input = await body<HandoffInput>(c);
    return respond(c, () => handoff.handoff(input));
  });

  app.get('/files', (c) => {
    const limit = Number(c.req.query('limit') ?? 30) || 30;
    return respond(c, () => searchRepoFiles(root, c.req.query('q') ?? '', limit));
  });
}
