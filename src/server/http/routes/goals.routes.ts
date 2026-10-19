import type { Hono } from 'hono';
import type { GoalPatch } from '../../../shared/types/index.js';
import type { GoalRunner } from '../../workflow/goal-runner.js';
import { body, respond } from '../respond.js';

/** Goals: start a run, and the human's controls over it (approve, request changes, pause/resume, cancel). */
export function goalRoutes(app: Hono, goals: GoalRunner) {
  app.get('/goals', (c) => c.json(goals.list()));
  app.post('/goals', async (c) => {
    const { brief, title } = await body<{ brief?: string; title?: string }>(c);
    return respond(c, () => goals.start(String(brief ?? ''), title));
  });
  app.patch('/goals/:id', async (c) => {
    const patch = await body<GoalPatch>(c);
    return respond(c, () => goals.update(c.req.param('id'), patch));
  });
  app.post('/goals/:id/approve', (c) => respond(c, () => goals.approve(c.req.param('id'))));
  app.post('/goals/:id/pause', (c) => respond(c, () => goals.pause(c.req.param('id'))));
  app.post('/goals/:id/resume', (c) => respond(c, () => goals.resume(c.req.param('id'))));
  app.post('/goals/:id/cancel', (c) => respond(c, () => goals.cancel(c.req.param('id'))));
  app.post('/goals/:id/replan', async (c) => {
    const { feedback } = await body<{ feedback?: string }>(c);
    return respond(c, () => goals.replan(c.req.param('id'), String(feedback ?? '')));
  });
  app.delete('/goals/:id', (c) => respond(c, () => goals.remove(c.req.param('id'))));
}
