import type { Hono } from 'hono';
import { AuditKind, WorkPhase } from '../../../shared/enums.js';
import type { ExperimentVariant } from '../../../shared/types/index.js';
import type { HumanAudit } from '../../services/audit.service.js';
import type { EngineService } from '../../engine/engine.service.js';
import type { HostToolBridge } from '../../providers/host-bridge.js';
import { HOST_BRIDGE_PATH } from '../../providers/host-bridge.js';
import { body, respond } from '../respond.js';

const PHASES = new Set<string>(Object.values(WorkPhase));
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Providers, routing estimate, experiments, suggestions, outcomes and replay evals (session-token API). */
export function engineRoutes(api: Hono, engine: EngineService, audit: HumanAudit) {
  api.get('/engine/providers', (c) => respond(c, () => engine.providers()));
  api.put('/engine/providers/:id/key', async (c) => {
    const { key } = await body<{ key?: string }>(c);
    return respond(c, () => {
      const id = c.req.param('id');
      engine.setKey(id, typeof key === 'string' ? key : '');
      audit(AuditKind.Settings, key ? `Saved an API key for ${id}` : `Removed the API key for ${id}`);
      return { ok: true };
    });
  });
  api.get('/engine/estimate', (c) => respond(c, () => engine.estimate()));

  api.get('/engine/outcomes', (c) => respond(c, () => engine.outcomes.all()));
  api.post('/engine/outcomes/refresh', (c) => respond(c, () => engine.refreshOutcomes()));

  api.get('/engine/experiments', (c) => respond(c, () => engine.experimentResults()));
  api.post('/engine/experiments', async (c) => {
    const b = await body<{ name?: string; botId?: string; phase?: string; change?: Partial<ExperimentVariant> }>(c);
    return respond(c, () => {
      if (b.phase && !PHASES.has(b.phase)) throw new Error('Unknown phase.');
      const exp = engine.createExperiment({
        name: String(b.name ?? ''),
        botId: String(b.botId ?? ''),
        ...(b.phase ? { phase: b.phase as WorkPhase } : {}),
        change: { ...(b.change?.label ? { label: String(b.change.label) } : {}), addSkills: list(b.change?.addSkills), removeSkills: list(b.change?.removeSkills), promptAppend: String(b.change?.promptAppend ?? '') },
      });
      audit(AuditKind.Settings, `Started experiment "${exp.name}" on ${exp.botId}`);
      return exp;
    });
  });
  api.patch('/engine/experiments/:id', async (c) => {
    const b = await body<{ status?: string; name?: string }>(c);
    return respond(c, () => {
      if (b.status && b.status !== 'running' && b.status !== 'stopped') throw new Error('status must be running or stopped');
      const exp = engine.experiments.update(c.req.param('id'), { ...(b.status ? { status: b.status as 'running' | 'stopped' } : {}), ...(typeof b.name === 'string' ? { name: b.name } : {}) });
      if (b.status) audit(AuditKind.Settings, `${b.status === 'stopped' ? 'Stopped' : 'Resumed'} experiment "${exp.name}"`);
      return exp;
    });
  });
  api.delete('/engine/experiments/:id', (c) =>
    respond(c, () => {
      const exp = engine.experiments.get(c.req.param('id'));
      engine.experiments.remove(c.req.param('id'));
      if (exp) audit(AuditKind.Settings, `Deleted experiment "${exp.name}"`);
      return { ok: true };
    }),
  );

  api.get('/engine/suggestions', (c) => respond(c, () => engine.suggestions()));
  api.post('/engine/suggestions/:id/apply', async (c) => {
    const { mode } = await body<{ mode?: string }>(c);
    return respond(c, () => {
      const res = engine.applySuggestion(c.req.param('id'), mode === 'experiment' ? 'experiment' : 'apply');
      audit(AuditKind.Settings, `Applied suggestion: ${res.applied}`);
      return res;
    });
  });
  api.post('/engine/suggestions/:id/dismiss', (c) => respond(c, () => engine.dismissSuggestion(c.req.param('id'))));

  api.get('/engine/evals', (c) => respond(c, () => engine.listEvals()));
  api.post('/engine/evals', async (c) => {
    const b = await body<{ goalId?: string; botId?: string; variant?: Partial<ExperimentVariant> }>(c);
    return respond(c, () =>
      engine.startEval({
        goalId: String(b.goalId ?? ''),
        ...(b.botId ? { botId: String(b.botId) } : {}),
        variant: { label: String(b.variant?.label ?? ''), addSkills: list(b.variant?.addSkills), removeSkills: list(b.variant?.removeSkills), promptAppend: String(b.variant?.promptAppend ?? '') },
      }),
    );
  });
}

/**
 * The host-tool MCP endpoint for out-of-process providers (Codex, Gemini). Mounted outside the
 * session-token API: each run has its own random token in the path, valid only while the run lasts.
 * The tunnel guard keeps it local.
 */
export function hostBridgeRoutes(app: Hono, bridge: HostToolBridge) {
  app.post(`${HOST_BRIDGE_PATH}/:token`, async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }
    const res = await bridge.handle(c.req.param('token'), payload);
    if (!res) return c.body(null, 202);
    return c.json(res.json as object, res.status as 200);
  });
  app.get(`${HOST_BRIDGE_PATH}/:token`, (c) => c.text('Method not allowed', 405));
  app.delete(`${HOST_BRIDGE_PATH}/:token`, (c) => c.body(null, 204));
}
