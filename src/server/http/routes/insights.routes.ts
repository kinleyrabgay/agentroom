import type { Hono } from 'hono';
import type { InsightsPeriod } from '../../../shared/types/index.js';
import type { InsightsService } from '../../services/insights.service.js';
import { respond } from '../respond.js';

const PERIODS = new Set<InsightsPeriod>(['7d', '30d', '90d']);

/** Replay timeline for a goal, and team insights over a period. Read-only. */
export function insightsRoutes(app: Hono, insights: InsightsService) {
  app.get('/goals/:id/timeline', (c) => respond(c, () => insights.timeline(c.req.param('id'))));
  app.get('/insights', (c) =>
    respond(c, () => {
      const p = (c.req.query('period') ?? '30d') as InsightsPeriod;
      if (!PERIODS.has(p)) throw new Error('period must be one of: 7d, 30d, 90d');
      return insights.insights(p);
    }),
  );
}
