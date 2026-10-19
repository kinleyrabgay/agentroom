import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { TOKEN_HEADER } from '../../shared/constants.js';

/** Random per-run session token. It's printed in the start URL; every API/WS call must carry it. */
export function createSessionToken(): string {
  return randomBytes(18).toString('base64url');
}

export function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireToken(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    if (!tokenMatches(token, c.req.header(TOKEN_HEADER))) return c.json({ error: 'unauthorized' }, 401);
    await next();
  };
}

/** Allow the Next dev server (another origin) to call the API — only when AGENTROOM_DEV_ORIGIN is set. */
export function devCors(origin: string | undefined): MiddlewareHandler | null {
  if (!origin) return null;
  return cors({ origin, allowHeaders: ['content-type', TOKEN_HEADER], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
}
