import type { Context, Hono, MiddlewareHandler } from 'hono';
import QRCode from 'qrcode';
import type { RemoteService } from '../../remote/remote.service.js';
import { MOBILE_HTML } from '../../remote/mobile-page.js';
import { body, respond } from '../respond.js';

/** Paths reachable through the public tunnel; everything else is refused there. The Teams webhook checks its own HMAC signature. */
export const REMOTE_PUBLIC_PATH = /^\/(m|remote-api\/.*|teams\/inbound)$/;
export const REMOTE_TOKEN_HEADER = 'x-remote-token';

/** True for requests that came in through Cloudflare (the phone tunnel), not from this machine. */
export const viaTunnel = (c: Context) => !!(c.req.header('cf-ray') || c.req.header('cf-connecting-ip'));

/** Through the tunnel only the phone page and its API exist. */
export function tunnelGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (viaTunnel(c) && !REMOTE_PUBLIC_PATH.test(c.req.path)) return c.text('Not found', 404);
    await next();
  };
}

/** Local controls (session-token API): status with QR, turn on, revoke. */
export function remoteControlRoutes(api: Hono, remote: RemoteService) {
  const withQr = async () => {
    const s = remote.status();
    return { ...s, ...(s.link ? { qrSvg: await QRCode.toString(s.link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) } : {}) };
  };
  api.get('/remote', (c) => respond(c, withQr));
  api.post('/remote/enable', async (c) => {
    const { hours } = await body<{ hours?: number }>(c);
    return respond(c, async () => {
      await remote.enable(hours === undefined ? undefined : Number(hours));
      return withQr();
    });
  });
  api.post('/remote/disable', (c) => respond(c, () => remote.disable()));
}

/** The phone page and its API. Remote token only; nothing but what's waiting on the human. */
export function remotePublicRoutes(app: Hono, remote: RemoteService) {
  app.get('/m', (c) => {
    c.header('cache-control', 'no-store');
    c.header('x-frame-options', 'DENY');
    c.header('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    return c.html(MOBILE_HTML);
  });

  const guard: MiddlewareHandler = async (c, next) => {
    const key = c.req.header('cf-connecting-ip') ?? 'local';
    if (!remote.allow(key)) return c.json({ error: 'Too many requests. Wait a minute.' }, 429);
    if (!remote.validate(c.req.header(REMOTE_TOKEN_HEADER))) return c.json({ error: 'unauthorized' }, 401);
    c.header('cache-control', 'no-store');
    await next();
  };
  app.use('/remote-api/*', guard);
  app.get('/remote-api/pending', (c) => c.json(remote.pending()));
  app.post('/remote-api/approvals/:id', async (c) => {
    const { allow } = await body<{ allow?: boolean }>(c);
    return respond(c, () => remote.decide(c.req.param('id'), allow === true));
  });
  app.post('/remote-api/questions/:id', async (c) => {
    const { answer } = await body<{ answer?: string }>(c);
    return respond(c, () => remote.answer(c.req.param('id'), String(answer ?? '')));
  });
  app.post('/remote-api/plans/:id/approve', (c) => respond(c, () => remote.approvePlan(c.req.param('id'))));
  app.post('/remote-api/plans/:id/changes', async (c) => {
    const { feedback } = await body<{ feedback?: string }>(c);
    return respond(c, () => remote.requestChanges(c.req.param('id'), String(feedback ?? '')));
  });
}
