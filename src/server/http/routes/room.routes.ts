import type { Context, Hono } from 'hono';
import { currentPrincipal, type Principal } from '../../room/principal.js';
import { RoomError, type RoomService } from '../../room/room.service.js';
import { body } from '../respond.js';

/** Run a room action; RoomError → its status, anything else → 400. */
async function act(c: Context, fn: () => unknown | Promise<unknown>) {
  try {
    return c.json(await fn());
  } catch (err) {
    const status = err instanceof RoomError ? err.status : 400;
    return c.json({ error: (err as Error).message }, status as 400);
  }
}

const me = (): Principal => {
  const p = currentPrincipal();
  if (!p) throw new RoomError('unauthorized', 401);
  return p;
};

/** Owner-only admin routes (members are refused by the access policy before reaching these). */
function ownerOnly(): Principal {
  const p = me();
  if (p.kind !== 'owner') throw new RoomError('Only the room owner can do that.', 403);
  return p;
}

/** Team room: admin (owner), and what every member needs (me, presence, comments, notifications). */
export function roomRoutes(app: Hono, room: RoomService) {
  // ----- admin (owner) -----
  app.get('/room', (c) => act(c, () => (ownerOnly(), room.status())));
  app.post('/room/enable', (c) => act(c, () => (ownerOnly(), room.setEnabled(true))));
  app.post('/room/disable', (c) => act(c, () => (ownerOnly(), room.setEnabled(false))));
  app.post('/room/lan', async (c) => {
    const { on, address } = await body<{ on?: boolean; address?: string }>(c);
    return act(c, () => (ownerOnly(), on === false ? room.disableLan() : room.enableLan(address ? String(address) : undefined)));
  });
  app.post('/room/tunnel', async (c) => {
    const { on } = await body<{ on?: boolean }>(c);
    return act(c, () => (ownerOnly(), on === false ? room.disableTunnel() : room.enableTunnel()));
  });
  app.post('/room/members', async (c) => {
    const input = await body<{ name?: string; email?: string; role?: string; days?: number }>(c);
    return act(c, () => (ownerOnly(), room.invite(input)));
  });
  app.patch('/room/members/:id', async (c) => {
    const { role } = await body<{ role?: string }>(c);
    return act(c, () => (ownerOnly(), room.setRole(c.req.param('id'), role)));
  });
  app.post('/room/members/:id/link', async (c) => {
    const { days } = await body<{ days?: number }>(c);
    return act(c, () => (ownerOnly(), room.reissue(c.req.param('id'), days)));
  });
  app.delete('/room/members/:id', (c) => act(c, () => (ownerOnly(), room.revoke(c.req.param('id')))));
  app.post('/room/rotate', (c) => act(c, () => (ownerOnly(), room.rotate())));

  // ----- everyone in the room -----
  app.get('/room/me', (c) => act(c, () => room.me(me())));
  app.get('/room/presence', (c) => act(c, () => (me(), room.presence())));
  app.get('/room/goal-owners', (c) => act(c, () => (me(), room.goalOwners())));
  app.get('/room/comments', (c) => act(c, () => (me(), room.comments(c.req.query('goalId') || undefined))));
  app.post('/room/comments', async (c) => {
    const input = await body<{ goalId?: string; target?: string; body?: string }>(c);
    return act(c, () => room.addComment(me(), input));
  });
  app.delete('/room/comments/:id', (c) => act(c, () => room.removeComment(me(), c.req.param('id'))));
  app.get('/room/notifications', (c) => act(c, () => room.notifications(me())));
  app.post('/room/notifications/read', async (c) => {
    const { ids } = await body<{ ids?: string[] }>(c);
    return act(c, () => room.markRead(me(), ids));
  });
}
