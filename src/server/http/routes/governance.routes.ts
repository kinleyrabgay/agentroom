import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { AuditQuery } from '../../../shared/types/index.js';
import type { AuditService } from '../../services/audit.service.js';
import type { LedgerService } from '../../services/ledger.service.js';
import { respond } from '../respond.js';

const AUDIT_KINDS = new Set<string>(Object.values(AuditKind));

/** Read-only views over the run ledger and the audit log. */
export function governanceRoutes(app: Hono, ledger: LedgerService, audit: AuditService) {
  app.get('/ledger', (c) =>
    respond(c, () =>
      ledger.list({
        goalId: c.req.query('goalId') || undefined,
        botId: c.req.query('botId') || undefined,
        since: c.req.query('since') || undefined,
      }),
    ),
  );

  app.get('/audit', (c) =>
    respond(c, () => {
      const kind = c.req.query('kind');
      if (kind && !AUDIT_KINDS.has(kind)) throw new Error(`unknown audit kind "${kind}"`);
      const limit = Number(c.req.query('limit'));
      const q: AuditQuery = {
        q: c.req.query('q') || undefined,
        kind: (kind || undefined) as AuditQuery['kind'],
        botId: c.req.query('botId') || undefined,
        goalId: c.req.query('goalId') || undefined,
        before: c.req.query('before') || undefined,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      };
      return audit.query(q);
    }),
  );
}
