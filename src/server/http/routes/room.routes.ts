import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { RoomService } from '../../rooms/room.service.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { body, respond } from '../respond.js';

/** Multi-repo rooms: the room (null in single-project mode), its merged map, and syncing every repo. */
export function roomRoutes(app: Hono, room: RoomService, audit: HumanAudit) {
  app.get('/room', (c) => respond(c, () => room.view()));
  app.get('/room/graph', (c) => respond(c, () => room.graph()));
  app.get('/room/edges', (c) => respond(c, () => room.crossEdges()));
  app.post('/room/sync', async (c) => {
    const { cards } = await body<{ cards?: boolean }>(c);
    return respond(c, () => {
      const repos = room.registry.list();
      audit(AuditKind.Settings, `Room context sync started for ${repos.map((r) => r.id).join(', ')}${cards ? ' (with cards)' : ''}`);
      // Runs in the background, repo by repo; each repo's progress arrives over the live channel.
      void (async () => {
        for (const r of repos) await room.context(r.id).sync({ cards: cards === true }).catch(() => {});
      })();
      return room.view();
    });
  });
}
