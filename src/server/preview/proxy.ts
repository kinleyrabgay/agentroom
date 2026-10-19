import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { BIND_HOST, PUBLIC_HOST } from '../../shared/constants.js';
import { BRIDGE_SCRIPT_PATH } from '../config/constants.js';
import { BRIDGE_JS } from './bridge.js';
import { swapOrigin } from './url.js';
import { CookieJar, FORWARD_PATH, forwardRequest } from './forward.js';

const BRIDGE_TAG = `<script src="${BRIDGE_SCRIPT_PATH}"></script>`;
/** Headers that stop a page from being framed (or pin it to https). */
const STRIPPED_HEADERS = ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'strict-transport-security'];

export interface PreviewProxy {
  server: http.Server;
  /** Where the proxy listens, e.g. http://127.0.0.1:53121 */
  origin: string;
  target: URL;
  close(): void;
}

/**
 * Reverse proxy for one site. Makes pages frameable, injects the bridge script into HTML,
 * rewrites redirects/cookies to stay on the proxy, and pipes WebSockets (hot reload) through.
 */
export function startProxy(target: URL): Promise<PreviewProxy> {
  const client = target.protocol === 'https:' ? https : http;
  const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
  let origin = '';
  const toTarget = (v: string) => swapOrigin(v, origin, target.origin);
  const toProxy = (v: string) => swapOrigin(v, target.origin, origin);

  const jar = new CookieJar();
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith(`${FORWARD_PATH}?`)) {
      forwardRequest(req, res, target.origin, jar).catch(() => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      return;
    }
    if (req.url?.startsWith(BRIDGE_SCRIPT_PATH)) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(BRIDGE_JS);
      return;
    }
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host, 'accept-encoding': 'gzip, deflate, br' };
    for (const h of ['origin', 'referer'] as const) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = toTarget(v);
    }

    const upstream = client.request({ hostname: target.hostname, port, method: req.method, path: req.url, headers }, (ur) => {
      const h = rewriteResponseHeaders(ur.headers, toProxy);
      if (!String(ur.headers['content-type'] ?? '').includes('text/html')) {
        res.writeHead(ur.statusCode ?? 502, h);
        ur.pipe(res);
        return;
      }
      decodeBody(ur, String(ur.headers['content-encoding'] ?? ''))
        .then((html) => {
          delete h['content-length'];
          delete h['content-encoding'];
          res.writeHead(ur.statusCode ?? 200, h);
          res.end(injectBridge(html));
        })
        .catch(() => {
          res.writeHead(502, { 'content-type': 'text/html' });
          res.end(errorPage(target, 'Could not decode the response'));
        });
    });
    upstream.on('error', (err) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
      res.end(errorPage(target, (err as NodeJS.ErrnoException).code ?? err.message));
    });
    req.pipe(upstream);
  });

  server.on('upgrade', (req, socket, head) => {
    const upstream = target.protocol === 'https:'
      ? tls.connect({ host: target.hostname, port, servername: target.hostname })
      : net.connect({ host: target.hostname, port });
    upstream.on('connect', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        let v = req.rawHeaders[i + 1];
        if (/^host$/i.test(k)) v = target.host;
        if (/^origin$/i.test(k)) v = toTarget(v);
        lines.push(`${k}: ${v}`);
      }
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  // Same port for the same site across restarts, so its origin (and the page's localStorage) stays put.
  const listen = (p: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(p, BIND_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
  return listen(preferredPort(target))
    .catch(() => listen(0))
    .then(() => {
      origin = `http://${proxyHostname(target)}:${(server.address() as net.AddressInfo).port}`;
      return { server, origin, target, close: () => server.close() };
    });
}

/**
 * Hostname the page is served under: `localhost`, the same site as the AgentRoom UI (so the frame
 * keeps its cookies and storage), and what apps expect when they check `location.hostname`.
 * `*.localhost` targets keep their name.
 */
export function proxyHostname(target: URL): string {
  const h = target.hostname.toLowerCase();
  return h.endsWith('.localhost') ? h : PUBLIC_HOST;
}

const PORT_BASE = 41000;
const PORT_SPAN = 2000;

/** A stable port for a site (hash of its origin), so reopening it after a restart keeps the same origin. */
export function preferredPort(target: URL): number {
  let h = 0;
  for (const ch of target.origin) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PORT_BASE + (h % PORT_SPAN);
}

export function injectBridge(html: string): string {
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + BRIDGE_TAG) : BRIDGE_TAG + html;
}

function rewriteResponseHeaders(src: http.IncomingHttpHeaders, toProxy: (v: string) => string): http.OutgoingHttpHeaders {
  const h: http.OutgoingHttpHeaders = { ...src };
  for (const k of STRIPPED_HEADERS) delete h[k];
  if (typeof h.location === 'string') h.location = toProxy(h.location);
  if (Array.isArray(h['set-cookie'])) {
    h['set-cookie'] = h['set-cookie'].map((c) =>
      c.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Secure/gi, '').replace(/;\s*SameSite=None/gi, '; SameSite=Lax'),
    );
  }
  return h;
}

function decodeBody(stream: http.IncomingMessage, encoding: string): Promise<string> {
  const decoder = encoding.includes('br') ? zlib.createBrotliDecompress()
    : encoding.includes('gzip') ? zlib.createGunzip()
    : encoding.includes('deflate') ? zlib.createInflate()
    : null;
  const src = decoder ? stream.pipe(decoder) : stream;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    src.on('data', (c: Buffer) => chunks.push(c));
    src.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    src.on('error', reject);
  });
}

function errorPage(target: URL, reason: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><head>${BRIDGE_TAG}<title>Can't reach ${esc(target.host)}</title></head>
<body style="font:14px system-ui;display:grid;place-items:center;height:90vh;color:#666;text-align:center">
<div><div style="font-size:40px">🔌</div><h2 style="color:#222;font-weight:600">Can't reach ${esc(target.origin)}</h2>
<p>${esc(reason)}</p><p>Is the dev server running?</p></div></body></html>`;
}
