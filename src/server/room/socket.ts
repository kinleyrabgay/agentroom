import type { Context } from 'hono';
import type { WSEvents } from 'hono/ws';
import { ClientMessageType } from '../../shared/enums.js';
import { TOKEN_QUERY } from '../../shared/constants.js';
import { WS_UNAUTHORIZED } from '../config/constants.js';
import type { Client, Hub } from '../realtime/hub.js';
import type { ClientMessageRouter } from '../realtime/ws.handler.js';
import { memberMaySend } from './access.js';
import { principalFor, sourceOf } from './auth.js';
import { runAs } from './principal.js';
import type { RoomService } from './room.service.js';

/** Close code for a member removed or whose link stopped working. */
export const WS_REMOVED = 4403;

interface SocketDeps {
  token: string;
  room: RoomService;
  hub: Hub;
  router: ClientMessageRouter;
  onConnect: () => void;
}

/**
 * The live channel with the team room: owner or member, members limited to what their role may
 * send (presence; approvers also chat, approvals, answers, stop) and never the browser bridge.
 */
export function roomSocket(c: Context, deps: SocketDeps): WSEvents {
  const { room } = deps;
  const source = sourceOf(c);
  let principal = room.blocked(source) ? null : principalFor(c, deps.token, room, c.req.query(TOKEN_QUERY));
  // Members must connect from the page they were served (same origin); the owner's token already proves it's them.
  if (principal?.kind === 'member') {
    const origin = c.req.header('origin');
    let same = false;
    try {
      same = !!origin && new URL(origin).host === c.req.header('host');
    } catch {}
    if (!same) principal = null;
  }
  if (!principal) room.noteFailure(source);

  const client: Client & { close?: () => void } = { send: () => {}, ...(principal?.kind === 'member' ? { guest: true } : {}) };
  return {
    onOpen(_e, ws) {
      if (!principal) return ws.close(WS_UNAUTHORIZED, 'unauthorized');
      client.send = (d) => ws.send(d);
      client.close = () => ws.close(WS_REMOVED, 'removed');
      deps.hub.add(client);
      room.attach(client, principal);
      deps.onConnect();
    },
    onMessage(e, ws) {
      if (!principal) return;
      if (!room.stillValid(principal)) return ws.close(WS_REMOVED, 'removed');
      const raw = String(e.data);
      let type: unknown;
      let active: unknown;
      try {
        ({ type, active } = JSON.parse(raw) as { type?: unknown; active?: unknown });
      } catch {
        return;
      }
      if (type === ClientMessageType.Presence) room.setActive(client, !!active);
      if (principal.kind === 'member') {
        if (!room.allowRequest(principal.id)) return;
        if (!memberMaySend(room.roleOf(principal), type)) return;
      }
      const p = principal;
      runAs(p, () => deps.router(client, raw));
    },
    onClose() {
      deps.hub.remove(client);
      room.detach(client);
    },
  };
}
