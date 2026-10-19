import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { SentryHandoffInput, SentryIssueQuery } from '../../../shared/types/index.js';
import type { HumanAudit } from '../../services/audit.service.js';
import type { SentryService } from '../../integrations/sentry/sentry.service.js';
import { body, respond } from '../respond.js';

const ONE_OF = {
  status: ['unresolved', 'resolved', 'ignored', 'all'],
  level: ['fatal', 'error', 'warning', 'info', 'debug'],
  assigned: ['me', 'unassigned', 'any'],
  sort: ['date', 'new', 'freq', 'user'],
  period: ['24h', '7d', '14d', '30d', '90d'],
} as const;

/** Sentry page: connect (token, org, projects), list issues with filters, issue detail, hand issues to bots. Read-only towards Sentry. */
export function sentryRoutes(app: Hono, sentry: SentryService, handoff: (input: SentryHandoffInput) => Promise<{ botId: string; goal?: { id: string } }>, audit: HumanAudit, onToken?: () => void) {
  app.get('/sentry', (c) => c.json(sentry.status()));
  app.put('/sentry/token', async (c) => {
    const { token, host } = await body<{ token?: string; host?: string }>(c);
    return respond(c, async () => {
      const orgs = await sentry.setToken(String(token ?? ''), host || undefined);
      // The value is never logged.
      audit(AuditKind.Settings, 'Sentry token updated');
      onToken?.();
      return { orgs };
    });
  });
  app.get('/sentry/orgs', (c) => respond(c, () => sentry.orgs(c.req.query('host') || undefined)));
  app.get('/sentry/projects', (c) => respond(c, () => sentry.projects(c.req.query('org') || undefined)));
  app.get('/sentry/environments', (c) => respond(c, () => sentry.environments()));
  app.put('/sentry', async (c) => {
    const b = await body<{ org?: string; projects?: string[]; environment?: string; host?: string }>(c);
    return respond(c, async () => {
      const status = await sentry.connect({ org: String(b.org ?? ''), projects: b.projects ?? [], ...(b.environment ? { environment: b.environment } : {}), ...(b.host ? { host: b.host } : {}) });
      audit(AuditKind.Settings, `Connected Sentry ${status.config?.org}${status.config?.projects.length ? ` (${status.config.projects.join(', ')})` : ''}`);
      return status;
    });
  });
  app.delete('/sentry', (c) =>
    respond(c, () => {
      sentry.disconnect();
      audit(AuditKind.Settings, 'Disconnected Sentry');
    }),
  );

  app.get('/sentry/issues', (c) =>
    respond(c, () => {
      const q = c.req.query();
      const pick = <K extends keyof typeof ONE_OF>(k: K) => {
        const v = q[k];
        if (!v) return undefined;
        if (!(ONE_OF[k] as readonly string[]).includes(v)) throw new Error(`${k} must be one of: ${ONE_OF[k].join(', ')}`);
        return v as never;
      };
      const query: SentryIssueQuery = {
        ...(q.query ? { query: q.query.slice(0, 500) } : {}),
        ...(q.projects ? { projects: q.projects.split(',').filter(Boolean) } : {}),
        ...(q.environment ? { environment: q.environment } : {}),
        ...(q.cursor ? { cursor: q.cursor } : {}),
        status: pick('status'),
        level: pick('level'),
        assigned: pick('assigned'),
        sort: pick('sort'),
        period: pick('period'),
      };
      return sentry.issues(query);
    }),
  );
  app.get('/sentry/issues/:id', (c) => respond(c, () => sentry.detail(c.req.param('id'), { fresh: c.req.query('refresh') === '1' })));
  app.post('/sentry/handoff', async (c) => {
    const input = await body<SentryHandoffInput>(c);
    return respond(c, async () => {
      const result = await handoff(input);
      audit(AuditKind.Handoff, `Handed ${input.issueIds?.length ?? 0} Sentry issue(s) to ${result.botId}${result.goal ? ` → ${result.goal.id}` : ''}`, {
        botId: result.botId,
        ...(result.goal ? { goalId: result.goal.id } : {}),
        detail: { issueIds: input.issueIds, files: input.files, links: input.links },
      });
      return result;
    });
  });
}
