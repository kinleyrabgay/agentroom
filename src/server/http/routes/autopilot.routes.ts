import type { Hono } from 'hono';
import type { AutopilotService } from '../../autopilot/autopilot.service.js';
import type { GoalRunner } from '../../workflow/goal-runner.js';
import { respond } from '../respond.js';

/** Incident autopilot: start one for a Sentry issue, list an issue's runs, re-check a goal's failing test. */
export function autopilotRoutes(app: Hono, autopilot: AutopilotService, goals: GoalRunner) {
  // Starting from the UI never opens a PR on its own: the human reviews it.
  app.post('/autopilot/sentry/:issueId', (c) => respond(c, () => autopilot.startFromSentry(c.req.param('issueId'), { by: goals.human() })));
  app.get('/autopilot/sentry/:issueId', (c) => respond(c, () => autopilot.runs(c.req.param('issueId'))));
  app.post('/goals/:id/autopilot/verify', (c) => {
    const id = c.req.param('id');
    return respond(c, () => {
      if (goals.isRunning(id)) throw new Error(`${id} is still running. Wait for it to finish or pause it.`);
      return autopilot.verify(id);
    });
  });
}
