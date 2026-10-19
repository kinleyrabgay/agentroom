import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { MemoryNote } from '../../../shared/types/index.js';
import type { Project } from '../../../core/project.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { body, respond } from '../respond.js';

/** Bot memory: the notes in bots/<dir>/memory.md and the notes bots suggested. */
export function memoryRoutes(app: Hono, project: Project, audit: HumanAudit) {
  const bot = (id: string) => {
    const b = project.bots.get(id);
    if (!b) throw new Error(`Unknown bot "${id}".`);
    return b;
  };
  app.get('/bots/:id/memory', (c) => respond(c, () => project.memory.get(bot(c.req.param('id')))));
  app.put('/bots/:id/memory', async (c) => {
    const { notes } = await body<{ notes?: MemoryNote[] }>(c);
    return respond(c, () => {
      const b = bot(c.req.param('id'));
      if (!Array.isArray(notes)) throw new Error('Send { notes: [...] }.');
      project.memory.setNotes(b, notes);
      audit(AuditKind.Settings, `Memory of ${b.name} edited (${notes.length} notes)`, { botId: b.id });
      return project.memory.get(b);
    });
  });
  app.post('/bots/:id/memory/suggestions/:sid/keep', async (c) => {
    const { text } = await body<{ text?: string }>(c);
    return respond(c, () => {
      const b = bot(c.req.param('id'));
      const out = project.memory.keep(b, c.req.param('sid'), text);
      audit(AuditKind.Settings, `Kept a memory note for ${b.name}`, { botId: b.id });
      return out;
    });
  });
  app.post('/bots/:id/memory/suggestions/:sid/ignore', (c) => respond(c, () => project.memory.ignore(bot(c.req.param('id')), c.req.param('sid'))));
}
