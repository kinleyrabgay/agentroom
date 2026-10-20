import fs from 'node:fs';
import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import { proofAvailability } from '../../proof/browser.js';
import type { ProofService } from '../../proof/proof.service.js';
import type { HumanAudit } from '../../services/audit.service.js';
import type { GoalRunner } from '../../workflow/goal-runner.js';
import { body, respond } from '../respond.js';

/** Proof of work: the report, its frames, re-running it, editing the scenario, accepting failing checks. */
export function proofRoutes(app: Hono, proof: ProofService, goals: GoalRunner, root: string, audit: HumanAudit) {
  app.get('/proof/availability', (c) => respond(c, () => proofAvailability(root)));
  app.get('/goals/:id/proof', (c) => respond(c, () => proof.view(c.req.param('id'))));
  app.get('/goals/:id/proof/files/:name', (c) => {
    const f = proof.file(c.req.param('id'), c.req.param('name'));
    if (!f) return c.json({ error: 'not found' }, 404);
    return new Response(fs.readFileSync(f.path), {
      headers: {
        'content-type': f.type,
        'cache-control': 'private, max-age=60',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  });
  app.post('/goals/:id/proof/run', (c) => {
    const id = c.req.param('id');
    return respond(c, () => {
      const goal = goals.rerunProof(id);
      audit(AuditKind.Goal, `Recorded proof again for ${id}`, { goalId: id });
      return goal;
    });
  });
  app.post('/goals/:id/proof/override', (c) => {
    const id = c.req.param('id');
    return respond(c, () => {
      const goal = goals.overrideQuality(id);
      audit(AuditKind.Goal, `Accepted failing quality checks in ${id}`, { goalId: id });
      return goal;
    });
  });
  app.put('/goals/:id/proof/scenarios', async (c) => {
    const id = c.req.param('id');
    const { scenarios } = await body<{ scenarios?: unknown }>(c);
    return respond(c, () => {
      const out = proof.setScenarios(id, scenarios);
      audit(AuditKind.Goal, `Edited the proof scenario of ${id}`, { goalId: id, detail: { scenarios: out.length } });
      return out;
    });
  });
}
