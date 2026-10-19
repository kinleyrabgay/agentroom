import type { Hono } from 'hono';
import { ActorType, FindingSeverity, FindingStatus } from '../../../shared/enums.js';
import type { FindingQuery } from '../../../shared/types/index.js';
import type { SecurityService } from '../../security/security.service.js';
import type { GoalRunner } from '../../workflow/goal-runner.js';
import { body, respond } from '../respond.js';

const oneOf = <T extends string>(values: Record<string, T>, v: string | undefined, name: string): T | undefined => {
  if (v === undefined || v === '') return undefined;
  if (!Object.values(values).includes(v as T)) throw new Error(`${name} must be one of: ${Object.values(values).join(', ')}`);
  return v as T;
};

/** Security: findings (list, accept/dismiss) and on-demand scans. */
export function securityRoutes(app: Hono, security: SecurityService, goals: GoalRunner, humanName: () => string) {
  app.get('/security/findings', (c) =>
    respond(c, () => {
      const q: FindingQuery = {
        ...(c.req.query('goalId') ? { goalId: c.req.query('goalId') } : {}),
        status: oneOf(FindingStatus, c.req.query('status'), 'status'),
        severity: oneOf(FindingSeverity, c.req.query('severity'), 'severity'),
      };
      return security.findings.list(q);
    }),
  );
  app.post('/security/findings/:id/resolve', async (c) => {
    const { status, note } = await body<{ status?: string; note?: string }>(c);
    return respond(c, () => {
      if (status !== FindingStatus.Approved && status !== FindingStatus.Dismissed) throw new Error('status must be "approved" or "dismissed"');
      return security.findings.resolve(c.req.param('id'), status, { type: ActorType.Human, name: humanName() }, note?.trim() || undefined);
    });
  });
  app.post('/security/scan', async (c) => {
    const { goalId } = await body<{ goalId?: string }>(c);
    return respond(c, async () => {
      if (goalId) {
        await goals.refreshRisk(goalId);
        return security.findings.list({ goalId });
      }
      return (await security.scan({})).findings;
    });
  });
}
