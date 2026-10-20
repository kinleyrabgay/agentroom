import type { Context, Hono } from 'hono';
import { REPO_HEADER } from '../../../shared/constants.js';
import { AuditKind } from '../../../shared/enums.js';
import type { ContextClaimSection } from '../../../shared/types/index.js';
import type { ContextService } from '../../context/context.service.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { body, respond } from '../respond.js';

const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

/** Repo context: status, the module graph, cards and the human's feedback on them. */
export function contextRoutes(app: Hono, source: ContextService | ((repo: string | undefined) => ContextService), audit: HumanAudit) {
  // Multi-repo workspaces: the repo comes from a header (or ?repo= for links); unset = the primary repo.
  const at = (c: Context): ContextService => (typeof source === 'function' ? source(c.req.header(REPO_HEADER) || c.req.query('repo') || undefined) : source);
  app.get('/context/status', (c) => respond(c, () => at(c).status()));
  app.get('/context/graph', (c) => respond(c, () => at(c).graph()));
  app.get('/context/index', (c) => respond(c, () => at(c).index()));
  app.get('/context/files', (c) => respond(c, () => at(c).files()));
  app.get('/context/module/:id', (c) => respond(c, () => at(c).module(c.req.param('id'))));
  app.get('/context/file', (c) =>
    respond(c, () => at(c).peek(c.req.query('path') ?? '', { line: num(c.req.query('line')), start: num(c.req.query('start')), end: num(c.req.query('end')) })),
  );
  app.get('/context/find', (c) => respond(c, () => at(c).search(c.req.query('q') ?? '', num(c.req.query('limit')))));
  app.post('/context/impact', async (c) => {
    const { files } = await body<{ files?: unknown }>(c);
    return respond(c, () => {
      if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) throw new Error('Send { files: string[] }.');
      return at(c).impact(files as string[]);
    });
  });
  app.post('/context/sync', async (c) => {
    const { full, only, cards } = await body<{ full?: boolean; only?: string[]; cards?: boolean }>(c);
    return respond(c, () => {
      if (only !== undefined && (!Array.isArray(only) || only.some((x) => typeof x !== 'string'))) throw new Error('"only" must be a list of module ids.');
      const what = only?.length ? `cards for ${only.join(', ')}` : full ? 'full rebuild' : 'sync';
      audit(AuditKind.Settings, `Repo context ${what} started`);
      // Runs in the background; progress arrives over the live channel.
      void at(c).sync({ full: !!full, cards: cards !== false, ...(only?.length ? { only } : {}) }).catch(() => {});
      return at(c).status();
    });
  });
  app.put('/context/module/:id/notes', async (c) => {
    const { text } = await body<{ text?: string }>(c);
    return respond(c, () => {
      if (typeof text !== 'string') throw new Error('Send { text }.');
      const out = at(c).setNotes(c.req.param('id'), text);
      audit(AuditKind.Settings, `Context notes edited for ${out.id}`);
      return out;
    });
  });
  app.post('/context/module/:id/claims/:section/:index/reject', async (c) => {
    const { reason } = await body<{ reason?: string }>(c);
    return respond(c, () => {
      const index = num(c.req.param('index'));
      if (index === undefined) throw new Error('Bad claim index.');
      const out = at(c).reject(c.req.param('id'), c.req.param('section') as ContextClaimSection, index, reason ?? '');
      audit(AuditKind.Settings, `Context claim marked wrong in ${out.id}`, { detail: { reason: reason ?? '' } });
      return out;
    });
  });
  // ── Knowledge: ask, docs, tour ──
  app.get('/context/asks', (c) => respond(c, () => at(c).knowledge.history()));
  app.post('/context/ask', async (c) => {
    const { question } = await body<{ question?: string }>(c);
    return respond(c, () => {
      if (typeof question !== 'string' || !question.trim()) throw new Error('Send { question }.');
      return at(c).knowledge.ask(question, { signal: c.req.raw.signal });
    });
  });
  app.delete('/context/asks/:id', (c) => respond(c, () => at(c).knowledge.deleteAsk(c.req.param('id'))));
  app.post('/context/asks/:id/pin', async (c) => {
    const { moduleId } = await body<{ moduleId?: string }>(c);
    return respond(c, () => {
      if (typeof moduleId !== 'string' || !moduleId) throw new Error('Send { moduleId }.');
      const out = at(c).knowledge.pin(c.req.param('id'), moduleId);
      audit(AuditKind.Settings, `Ask answer pinned to ${moduleId} notes`);
      return out;
    });
  });
  app.get('/context/docs', (c) => respond(c, () => at(c).knowledge.docsPreview()));
  app.post('/context/docs/:id/write', async (c) => {
    const { sections } = await body<{ sections?: string[] }>(c);
    return respond(c, () => {
      const id = c.req.param('id');
      if (id !== 'architecture' && id !== 'decisions') throw new Error(`Unknown doc "${id}".`);
      if (sections !== undefined && (!Array.isArray(sections) || sections.some((s) => typeof s !== 'string'))) throw new Error('"sections" must be a list of section ids.');
      const out = at(c).knowledge.writeDoc(id, sections?.length ? sections : undefined);
      audit(AuditKind.Settings, `Generated ${out.path}${sections?.length ? ` (${sections.join(', ')})` : ''}`);
      return out;
    });
  });
  app.get('/context/tour', (c) => respond(c, () => at(c).knowledge.tour()));
  app.patch('/context/tour', async (c) => {
    const patch = await body<{ done?: Record<string, boolean>; current?: string | null; reset?: boolean }>(c);
    return respond(c, () => {
      if (patch.done !== undefined && (typeof patch.done !== 'object' || patch.done === null || Object.values(patch.done).some((v) => typeof v !== 'boolean'))) throw new Error('"done" maps module ids to true/false.');
      if (patch.current !== undefined && patch.current !== null && typeof patch.current !== 'string') throw new Error('"current" must be a module id.');
      return at(c).knowledge.tourProgress(patch);
    });
  });

  app.patch('/context/module/:id/decisions', async (c) => {
    const { decisions } = await body<{ decisions?: string[] }>(c);
    return respond(c, () => {
      const out = at(c).setDecisions(c.req.param('id'), decisions as string[]);
      audit(AuditKind.Settings, `Context decisions edited for ${out.id}`);
      return out;
    });
  });
}
