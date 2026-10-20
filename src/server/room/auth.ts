import type { Context, MiddlewareHandler } from 'hono';
import { API_PREFIX, TOKEN_HEADER, TOKEN_QUERY } from '../../shared/constants.js';
import { QUERY_TOKEN_ROUTE, tokenMatches } from '../http/auth.js';
import { viaTunnel } from '../http/routes/remote.routes.js';
import { memberMayCall } from './access.js';
import { runAs, type Principal } from './principal.js';
import type { RoomService } from './room.service.js';

type NodeBindings = { incoming?: { socket?: { remoteAddress?: string } } };

/** Peer address of the request (undefined for in-process requests, e.g. tests). */
export function remoteAddress(c: Context): string | undefined {
  return (c.env as NodeBindings | undefined)?.incoming?.socket?.remoteAddress;
}

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return true;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

/** Typed on this machine (not through the LAN listener or the tunnel). Only here does the owner token count. */
export function isLocal(c: Context): boolean {
  return isLoopback(remoteAddress(c)) && !viaTunnel(c);
}

/** Where a request comes from, for rate limiting failed sign-ins. */
export function sourceOf(c: Context): string {
  return (viaTunnel(c) ? c.req.header('cf-connecting-ip') : undefined) ?? remoteAddress(c) ?? 'local';
}

/**
 * Who is calling: the owner (session token, from this machine only) or a room member (signed link).
 * The owner's token is refused over the LAN and the tunnel, so a leaked start URL can't be used remotely.
 */
export function principalFor(c: Context, ownerToken: string, room: RoomService, provided: string | undefined): Principal | null {
  if (isLocal(c) && tokenMatches(ownerToken, provided)) return { kind: 'owner', ...room.ownerIdentity() };
  return room.authenticate(provided);
}

/** Same-origin check for members: a browser on another site can't drive a member's session. */
function sameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === c.req.header('host');
  } catch {
    return false;
  }
}

/**
 * API auth with the team room: resolves the principal, enforces member roles (default deny),
 * rate-limits, and runs the request as that person (audit entries name them).
 */
export function requireRoomAuth(ownerToken: string, room: RoomService): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const source = sourceOf(c);
    if (room.blocked(source)) return c.json({ error: 'Too many failed sign-ins. Wait a minute.' }, 429);
    const viaQuery = c.req.method === 'GET' && QUERY_TOKEN_ROUTE.test(c.req.path) ? c.req.query(TOKEN_QUERY) : undefined;
    const principal = principalFor(c, ownerToken, room, c.req.header(TOKEN_HEADER)) ?? principalFor(c, ownerToken, room, viaQuery);
    if (!principal) {
      room.noteFailure(source);
      return c.json({ error: 'unauthorized' }, 401);
    }
    const rel = c.req.path.startsWith(API_PREFIX) ? c.req.path.slice(API_PREFIX.length) || '/' : c.req.path;
    if (principal.kind === 'member') {
      if (!room.allowRequest(principal.id)) return c.json({ error: 'Too many requests. Wait a minute.' }, 429);
      if (!sameOrigin(c)) return c.json({ error: 'Cross-site request refused.' }, 403);
      const role = room.roleOf(principal);
      if (!memberMayCall(role, c.req.method, rel, (goalId) => room.ownsGoal(goalId, principal))) {
        return c.json({ error: role === 'viewer' ? 'Viewers can look but not change anything.' : 'Only the room owner can do that.' }, 403);
      }
    }
    c.header('cache-control', 'no-store');
    await runAs(principal, () => next());
    // Remember who started a goal (shown on the goal; lets an approver pause/cancel their own goals).
    if (c.req.method === 'POST' && rel === '/goals' && c.res.ok) {
      const goal = (await c.res.clone().json().catch(() => null)) as { id?: string } | null;
      if (goal?.id) room.setGoalOwner(goal.id, principal);
    }
  };
}

/**
 * DNS-rebinding and exposure guard for the extra listeners: a request from another machine must
 * name the LAN address we bound (or come through the room tunnel); anything else is refused.
 */
export function roomHostGuard(room: RoomService): MiddlewareHandler {
  return async (c, next) => {
    // This machine, or cloudflared (which connects from loopback; see tunnelGuard).
    if (isLoopback(remoteAddress(c))) return next();
    const lan = room.lanHost();
    if (!room.enabled || !lan || c.req.header('host') !== lan) return c.text('Misdirected request', 421);
    await next();
  };
}
