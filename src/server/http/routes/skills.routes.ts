import type { Hono } from 'hono';
import type { Project } from '../../../core/project.js';
import type { SkillInput } from '../../../shared/types/index.js';
import { body, respond } from '../respond.js';

/** The shared skill library. */
export function skillRoutes(app: Hono, project: Project) {
  app.get('/skills', (c) => c.json(project.library.list()));
  app.put('/skills/:name', async (c) => {
    const s = await body<Partial<SkillInput>>(c);
    return respond(c, () => project.library.save({ name: c.req.param('name'), description: s.description ?? '', body: s.body ?? '' }));
  });
  app.delete('/skills/:name', (c) => respond(c, () => project.deleteLibrarySkill(c.req.param('name'))));
}
