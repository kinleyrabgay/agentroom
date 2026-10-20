import type { Hono } from 'hono';
import type { Project } from '../../../core/project.js';
import type { ModelCatalog } from '../../services/model-catalog.js';
import { body, respond } from '../respond.js';

export function infoRoutes(app: Hono, project: Project, models: ModelCatalog) {
  app.get('/info', (c) => c.json(project.info()));
  app.get('/models', async (c) => c.json(await models.get()));
  // Personal by default (runs/config.local.json); ?scope=team writes the committed config.json.
  app.patch('/config', async (c) => {
    const patch = await body(c);
    const scope = c.req.query('scope') === 'team' ? 'team' : 'personal';
    return respond(c, () => project.config.update(patch, scope));
  });
}
