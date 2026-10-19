import type { Hono } from 'hono';
import type { Project } from '../../../core/project.js';
import type { BotPatch, NewBotInput, SkillInput } from '../../../shared/types/index.js';
import type { Team } from '../../agents/team.js';
import { body, respond } from '../respond.js';

export function botRoutes(app: Hono, project: Project, team: Team) {
  app.get('/bots', (c) => c.json(project.bots.list()));
  app.post('/bots', async (c) => {
    const b = await body<NewBotInput>(c);
    return respond(c, () => project.bots.create({ name: b.name, role: b.role, reportsTo: b.reportsTo }));
  });
  app.patch('/bots/:id', async (c) => {
    const patch = await body<BotPatch>(c);
    return respond(c, () => project.bots.update(c.req.param('id'), patch));
  });
  app.delete('/bots/:id', (c) => respond(c, () => project.bots.delete(c.req.param('id'))));
  app.post('/bots/:id/reset', (c) => respond(c, () => team.resetSession(c.req.param('id'))));

  // A bot's own skills: .agentroom/bots/<dir>/skills/<name>/SKILL.md
  app.put('/bots/:id/skills/:name', async (c) => {
    const s = await body<Partial<SkillInput>>(c);
    return respond(c, () =>
      project.saveBotSkill(c.req.param('id'), { name: c.req.param('name'), description: s.description ?? '', body: s.body ?? '' }),
    );
  });
  app.delete('/bots/:id/skills/:name', (c) => respond(c, () => project.deleteBotSkill(c.req.param('id'), c.req.param('name'))));
  app.post('/bots/:id/skills/:name/customize', (c) => respond(c, () => project.customizeSkill(c.req.param('id'), c.req.param('name'))));
}
