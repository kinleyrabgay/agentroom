import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { Goal, GoalPatch } from '../../../shared/types/index.js';
import type { HumanAudit } from '../../services/audit.service.js';
import type { GoalRunner } from '../../workflow/goal-runner.js';
import { body, respond } from '../respond.js';

/** Goals: start a run, and the human's controls over it (approve, request changes, pause/resume, cancel). */
export function goalRoutes(app: Hono, goals: GoalRunner, audit: HumanAudit) {
  /** Run a goal action and log it as the human's. */
  const act = (id: string, verb: string, fn: () => Goal | void, detail?: Record<string, unknown>) => {
    const out = fn();
    audit(AuditKind.Goal, `${verb} ${id}`, { goalId: id, ...(detail ? { detail } : {}) });
    return out;
  };
  app.get('/goals', (c) => c.json(goals.list()));
  app.post('/goals', async (c) => {
    const { brief, title } = await body<{ brief?: string; title?: string }>(c);
    return respond(c, () => {
      const goal = goals.start(String(brief ?? ''), title);
      audit(AuditKind.Goal, `Started ${goal.id}: ${goal.title}`, { goalId: goal.id });
      return goal;
    });
  });
  app.patch('/goals/:id', async (c) => {
    const patch = await body<GoalPatch>(c);
    return respond(c, () => goals.update(c.req.param('id'), patch));
  });
  app.post('/goals/:id/approve', (c) => respond(c, () => act(c.req.param('id'), 'Approved plan of', () => goals.approve(c.req.param('id')))));
  app.post('/goals/:id/pause', (c) => respond(c, () => act(c.req.param('id'), 'Paused', () => goals.pause(c.req.param('id')))));
  app.post('/goals/:id/resume', (c) => respond(c, () => act(c.req.param('id'), 'Resumed', () => goals.resume(c.req.param('id')))));
  app.post('/goals/:id/cancel', (c) => respond(c, () => act(c.req.param('id'), 'Cancelled', () => goals.cancel(c.req.param('id')))));
  app.post('/goals/:id/replan', async (c) => {
    const { feedback } = await body<{ feedback?: string }>(c);
    const id = c.req.param('id');
    return respond(c, () => act(id, 'Requested changes to', () => goals.replan(id, String(feedback ?? '')), { feedback }));
  });
  app.delete('/goals/:id', (c) => respond(c, () => act(c.req.param('id'), 'Deleted', () => goals.remove(c.req.param('id')))));
}
