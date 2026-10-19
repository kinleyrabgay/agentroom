import type { Hono } from 'hono';
import type { AlertPrefs } from '../../../shared/types/index.js';
import type { AlertService } from '../../services/alerts/alert.service.js';
import { body, respond } from '../respond.js';

/** Personal alert settings: OS notifications, sound, voice. */
export function alertRoutes(app: Hono, alerts: AlertService) {
  app.get('/alerts', (c) => c.json(alerts.get()));
  app.put('/alerts', async (c) => {
    const patch = await body<Partial<AlertPrefs>>(c);
    return respond(c, () => alerts.update(patch));
  });
  app.post('/alerts/test', (c) => respond(c, () => alerts.test()));
}
