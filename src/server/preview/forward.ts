import type http from 'node:http';

/** Path the bridge sends cross-origin requests to: `/__agentroom/forward?u=<absolute url>`. */
export const FORWARD_PATH = '/__agentroom/forward';
/** Set by the bridge. A custom header forces a CORS preflight, so other websites can't use the forwarder. */
export const FORWARD_HEADER = 'x-agentroom-forward';

const DROP_REQUEST = new Set([
  'host', 'origin', 'referer', 'cookie', 'connection', 'keep-alive', 'transfer-encoding', 'content-length',
  'accept-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer', FORWARD_HEADER,
]);
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);

/**
 * Cookies an upstream API set through the forwarder, kept server-side per origin. The browser's own
 * localhost cookies are never sent upstream, and upstream cookies never land in the browser.
 */
export class CookieJar {
  private jars = new Map<string, Map<string, string>>();

  header(origin: string): string | undefined {
    const jar = this.jars.get(origin);
    return jar?.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : undefined;
  }

  store(origin: string, setCookies: string[]) {
    const jar = this.jars.get(origin) ?? new Map<string, string>();
    for (const c of setCookies) {
      const [pair = '', ...attrs] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => {
        const [k = '', v = ''] = a.split('=').map((x) => x.trim());
        if (/^max-age$/i.test(k)) return Number(v) <= 0;
        if (/^expires$/i.test(k)) return Date.parse(v) < Date.now();
        return false;
      });
      if (expired || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    this.jars.set(origin, jar);
  }
}

/**
 * Send a page's cross-origin request upstream as if it came from the app's own origin
 * (so the API's CORS allow-list for the dev server applies), and return the response same-origin.
 */
export async function forwardRequest(req: http.IncomingMessage, res: http.ServerResponse, appOrigin: string, jar: CookieJar) {
  const fail = (status: number, msg: string) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(msg);
  };
  if (req.headers[FORWARD_HEADER] !== '1') return fail(403, 'Forbidden');
  let upstream: URL;
  try {
    upstream = new URL(new URL(req.url ?? '', 'http://x').searchParams.get('u') ?? '');
  } catch {
    return fail(400, 'Bad forward URL');
  }
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') return fail(400, 'Only http(s) can be forwarded');

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || DROP_REQUEST.has(k.toLowerCase())) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  headers.set('origin', appOrigin);
  headers.set('referer', `${appOrigin}/`);
  const cookie = jar.header(upstream.origin);
  if (cookie) headers.set('cookie', cookie);

  const method = (req.method ?? 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  let up: Response;
  try {
    up = await fetch(upstream, { method, headers, body: body ? new Uint8Array(body) : undefined, redirect: 'follow' });
  } catch (err) {
    return fail(502, `Can't reach ${upstream.origin}: ${(err as Error).message}`);
  }
  jar.store(upstream.origin, up.headers.getSetCookie());
  const out: Record<string, string> = {};
  up.headers.forEach((v, k) => {
    if (!DROP_RESPONSE.has(k) && !k.startsWith('access-control-')) out[k] = v;
  });
  const buf = Buffer.from(await up.arrayBuffer());
  res.writeHead(up.status, out);
  res.end(method === 'HEAD' ? undefined : buf);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
