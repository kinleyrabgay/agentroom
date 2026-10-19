import type { Hono } from 'hono';
import type { AutomationService } from '../../automation/automation.service.js';
import { parseWhen } from '../../automation/time-parse.js';
import type { RunnerStatus } from '../../../shared/types/index.js';
import { body, respond } from '../respond.js';

export interface RunnerControls {
  status: () => Promise<RunnerStatus>;
  install: () => Promise<RunnerStatus>;
  uninstall: () => Promise<RunnerStatus>;
}

/** Schedules, triggers, history, time parsing, the brief, and background mode. */
export function automationRoutes(app: Hono, automation: AutomationService, runner: RunnerControls) {
  app.post('/schedule/parse', async (c) => {
    const b = await body<{ text?: string; now?: string }>(c);
    return respond(c, () => parseWhen(String(b.text ?? '').slice(0, 2000), b.now ? new Date(b.now) : new Date()));
  });

  app.get('/automation', (c) => c.json(automation.snapshot()));
  app.get('/automation/next', (c) => c.json(automation.next()));
  app.get('/automation/history', (c) => c.json(automation.historyList(Number(c.req.query('limit') ?? 100) || 100)));
  app.post('/automation/seen', (c) => respond(c, () => automation.markSeen()));

  app.get('/schedules', (c) => c.json(automation.snapshot().schedules));
  app.post('/schedules', async (c) => {
    const b = await body<Parameters<AutomationService['createSchedule']>[0]>(c);
    return respond(c, () => automation.createSchedule(b));
  });
  app.patch('/schedules/:id', async (c) => {
    const b = await body<Parameters<AutomationService['updateSchedule']>[1]>(c);
    return respond(c, () => automation.updateSchedule(c.req.param('id'), b));
  });
  app.delete('/schedules/:id', (c) => respond(c, () => automation.deleteSchedule(c.req.param('id'))));
  app.post('/schedules/:id/run-now', (c) => respond(c, () => automation.runNow(c.req.param('id'))));

  app.get('/triggers', (c) => c.json(automation.snapshot().triggers));
  app.post('/triggers', async (c) => {
    const b = await body<Parameters<AutomationService['createTrigger']>[0]>(c);
    return respond(c, () => automation.createTrigger(b));
  });
  app.patch('/triggers/:id', async (c) => {
    const b = await body<Parameters<AutomationService['updateTrigger']>[1]>(c);
    return respond(c, () => automation.updateTrigger(c.req.param('id'), b));
  });
  app.delete('/triggers/:id', (c) => respond(c, () => automation.deleteTrigger(c.req.param('id'))));
  app.post('/triggers/:id/test', (c) => respond(c, () => automation.testTrigger(c.req.param('id'))));

  app.get('/brief', (c) => {
    const since = c.req.query('since');
    return respond(c, () => (since ? automation.brief(new Date(since).toISOString()) : automation.briefForReturn()));
  });
  app.post('/brief/dismiss', (c) => respond(c, () => automation.dismissBrief()));

  app.get('/runner', (c) => respond(c, () => runner.status()));
  app.post('/runner/install', (c) => respond(c, () => runner.install()));
  app.post('/runner/uninstall', (c) => respond(c, () => runner.uninstall()));
}
