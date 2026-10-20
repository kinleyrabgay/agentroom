import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { ContextClaimSection } from '../../../shared/types/index.js';
import type { ContextService } from '../../context/context.service.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { body, respond } from '../respond.js';

const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

/** Repo context: status, the module graph, cards and the human's feedback on them. */
export function contextRoutes(app: Hono, context: ContextService, audit: HumanAudit) {
  app.get('/context/status', (c) => respond(c, () => context.status()));
  app.get('/context/graph', (c) => respond(c, () => context.graph()));
  app.get('/context/index', (c) => respond(c, () => context.index()));
  app.get('/context/files', (c) => respond(c, () => context.files()));
  app.get('/context/module/:id', (c) => respond(c, () => context.module(c.req.param('id'))));
  app.get('/context/file', (c) =>
    respond(c, () => context.peek(c.req.query('path') ?? '', { line: num(c.req.query('line')), start: num(c.req.query('start')), end: num(c.req.query('end')) })),
  );
  app.get('/context/find', (c) => respond(c, () => context.search(c.req.query('q') ?? '', num(c.req.query('limit')))));
  app.post('/context/impact', async (c) => {
    const { files } = await body<{ files?: unknown }>(c);
    return respond(c, () => {
      if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) throw new Error('Send { files: string[] }.');
      return context.impact(files as string[]);
    });
  });
  app.post('/context/sync', async (c) => {
    const { full, only, cards } = await body<{ full?: boolean; only?: string[]; cards?: boolean }>(c);
    return respond(c, () => {
      if (only !== undefined && (!Array.isArray(only) || only.some((x) => typeof x !== 'string'))) throw new Error('"only" must be a list of module ids.');
      const what = only?.length ? `cards for ${only.join(', ')}` : full ? 'full rebuild' : 'sync';
      audit(AuditKind.Settings, `Repo context ${what} started`);
      // Runs in the background; progress arrives over the live channel.
      void context.sync({ full: !!full, cards: cards !== false, ...(only?.length ? { only } : {}) }).catch(() => {});
      return context.status();
    });
  });
  app.put('/context/module/:id/notes', async (c) => {
    const { text } = await body<{ text?: string }>(c);
    return respond(c, () => {
      if (typeof text !== 'string') throw new Error('Send { text }.');
      const out = context.setNotes(c.req.param('id'), text);
      audit(AuditKind.Settings, `Context notes edited for ${out.id}`);
      return out;
    });
  });
  app.post('/context/module/:id/claims/:section/:index/reject', async (c) => {
    const { reason } = await body<{ reason?: string }>(c);
    return respond(c, () => {
      const index = num(c.req.param('index'));
      if (index === undefined) throw new Error('Bad claim index.');
      const out = context.reject(c.req.param('id'), c.req.param('section') as ContextClaimSection, index, reason ?? '');
      audit(AuditKind.Settings, `Context claim marked wrong in ${out.id}`, { detail: { reason: reason ?? '' } });
      return out;
    });
  });
  // ── Knowledge: ask, docs, tour ──
  const k = context.knowledge;
  app.get('/context/asks', (c) => respond(c, () => k.history()));
  app.post('/context/ask', async (c) => {
    const { question } = await body<{ question?: string }>(c);
    return respond(c, () => {
      if (typeof question !== 'string' || !question.trim()) throw new Error('Send { question }.');
      return k.ask(question, { signal: c.req.raw.signal });
    });
  });
  app.delete('/context/asks/:id', (c) => respond(c, () => k.deleteAsk(c.req.param('id'))));
  app.post('/context/asks/:id/pin', async (c) => {
    const { moduleId } = await body<{ moduleId?: string }>(c);
    return respond(c, () => {
      if (typeof moduleId !== 'string' || !moduleId) throw new Error('Send { moduleId }.');
      const out = k.pin(c.req.param('id'), moduleId);
      audit(AuditKind.Settings, `Ask answer pinned to ${moduleId} notes`);
      return out;
    });
  });
  app.get('/context/docs', (c) => respond(c, () => k.docsPreview()));
  app.post('/context/docs/:id/write', async (c) => {
    const { sections } = await body<{ sections?: string[] }>(c);
    return respond(c, () => {
      const id = c.req.param('id');
      if (id !== 'architecture' && id !== 'decisions') throw new Error(`Unknown doc "${id}".`);
      if (sections !== undefined && (!Array.isArray(sections) || sections.some((s) => typeof s !== 'string'))) throw new Error('"sections" must be a list of section ids.');
      const out = k.writeDoc(id, sections?.length ? sections : undefined);
      audit(AuditKind.Settings, `Generated ${out.path}${sections?.length ? ` (${sections.join(', ')})` : ''}`);
      return out;
    });
  });
  app.get('/context/tour', (c) => respond(c, () => k.tour()));
  app.patch('/context/tour', async (c) => {
    const patch = await body<{ done?: Record<string, boolean>; current?: string | null; reset?: boolean }>(c);
    return respond(c, () => {
      if (patch.done !== undefined && (typeof patch.done !== 'object' || patch.done === null || Object.values(patch.done).some((v) => typeof v !== 'boolean'))) throw new Error('"done" maps module ids to true/false.');
      if (patch.current !== undefined && patch.current !== null && typeof patch.current !== 'string') throw new Error('"current" must be a module id.');
      return k.tourProgress(patch);
    });
  });

  app.patch('/context/module/:id/decisions', async (c) => {
    const { decisions } = await body<{ decisions?: string[] }>(c);
    return respond(c, () => {
      const out = context.setDecisions(c.req.param('id'), decisions as string[]);
      audit(AuditKind.Settings, `Context decisions edited for ${out.id}`);
      return out;
    });
  });
}
