import http from 'node:http';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hub } from '../src/server/realtime/hub.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import { resolveUrl } from '../src/server/preview/url.js';

let upstream: http.Server;
let target: string;
const hub = new Hub(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ar-pv-')), 'runs'));
const previews = new PreviewService(hub);

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `${target}/next` });
      return res.end();
    }
    if (req.url === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end('console.log(1)');
    }
    res.writeHead(200, {
      'content-type': 'text/html',
      'content-encoding': 'gzip',
      'content-security-policy': "frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'set-cookie': 'sid=1; Domain=localhost; Secure; SameSite=None',
    });
    res.end(zlib.gzipSync('<html><head><title>Hi</title></head><body>hello</body></html>'));
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterAll(() => {
  upstream.close();
  previews.closeAll();
});

describe('resolveUrl', () => {
  it('handles hosts, schemes and relative paths', () => {
    expect(resolveUrl('localhost:3000/a').href).toBe('http://localhost:3000/a');
    expect(resolveUrl('example.com').href).toBe('https://example.com/');
    expect(resolveUrl('/login', 'http://localhost:5173').href).toBe('http://localhost:5173/login');
    expect(() => resolveUrl('javascript:alert(1)')).toThrow();
  });
});

describe('preview proxy', () => {
  it('makes pages frameable and injects the bridge', async () => {
    const state = await previews.open('qa', `${target}/`);
    expect(state.target).toBe(target);
    const res = await fetch(state.proxy + '/');
    const html = await res.text();
    expect(html).toContain('<head><script src="/__agentroom/bridge.js"></script><title>Hi</title>');
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('set-cookie')).toBe('sid=1; SameSite=Lax');

    const js = await fetch(state.proxy + '/app.js').then((r) => r.text());
    expect(js).toBe('console.log(1)');
    const bridge = await fetch(state.proxy + '/__agentroom/bridge.js').then((r) => r.text());
    expect(bridge).toContain('__agentroomBridge');
  });

  it('rewrites redirects back through the proxy', async () => {
    const state = await previews.open('qa', `${target}/`);
    const res = await fetch(state.proxy + '/redirect', { redirect: 'manual' });
    expect(res.headers.get('location')).toBe(`${state.proxy}/next`);
  });

  it('bumps nav and keeps path in state', async () => {
    const a = await previews.open('dev', `${target}/x`);
    const b = await previews.open('dev', '/y?z=1');
    expect(b.nav).toBe(a.nav + 1);
    expect(b.path).toBe('/y?z=1');
    expect(b.proxy).toBe(a.proxy);
  });

  it('maps proxy URLs back to the real site', async () => {
    const a = await previews.open('dev', `${target}/x`);
    const b = await previews.open('dev', `${a.proxy}/z`);
    expect(b.target).toBe(target);
    expect(b.path).toBe('/z');
  });

  it('fails commands clearly when no UI is open', async () => {
    await expect(previews.command('qa', { op: 'snapshot' }, { name: 'QA', color: '#000' })).rejects.toThrow(/UI is not open/);
  });
});

describe('proxy hostname', () => {
  it('keeps localhost so apps that check location.hostname behave like in a normal tab', async () => {
    const { proxyHostname, startProxy } = await import('../src/server/preview/proxy.js');
    expect(proxyHostname(new URL('http://localhost:4200'))).toBe('localhost');
    expect(proxyHostname(new URL('http://app.localhost:3000'))).toBe('app.localhost');
    expect(proxyHostname(new URL('http://127.0.0.1:4200'))).toBe('localhost');

    const http = await import('node:http');
    const app = http.createServer((req, res) => res.end(`host=${req.headers.host}`));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const port = (app.address() as { port: number }).port;
    const proxy = await startProxy(new URL(`http://localhost:${port}`));
    try {
      expect(proxy.origin).toMatch(/^http:\/\/localhost:\d+$/);
      const res = await fetch(`${proxy.origin}/graphql`, { method: 'POST' });
      expect(await res.text()).toBe(`host=localhost:${port}`);
    } finally {
      proxy.close();
      app.close();
    }
  });
});

describe('cross-origin forwarder', () => {
  it('sends API calls with the app origin, keeps upstream cookies server-side, and refuses calls without the bridge header', async () => {
    const http = await import('node:http');
    const { startProxy } = await import('../src/server/preview/proxy.js');
    const seen: { origin?: string; cookie?: string; body: string }[] = [];
    const api = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ origin: req.headers.origin, cookie: req.headers.cookie, body });
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=abc; HttpOnly; Path=/', 'access-control-allow-origin': 'http://localhost:4200' });
        res.end('{"ok":true}');
      });
    });
    const app = http.createServer((_req, res) => res.end('app'));
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}/api/v1/users/sign_in`;
    const proxy = await startProxy(new URL(`http://localhost:${(app.address() as { port: number }).port}`));
    const fwd = `${proxy.origin}/__agentroom/forward?u=${encodeURIComponent(apiUrl)}`;
    try {
      expect((await fetch(fwd, { method: 'POST', body: '{}' })).status).toBe(403);

      const first = await fetch(fwd, { method: 'POST', body: '{"email":"a"}', headers: { 'x-agentroom-forward': '1', 'content-type': 'application/json', cookie: 'local=secret' } });
      expect(await first.json()).toEqual({ ok: true });
      expect(first.headers.get('set-cookie')).toBeNull();
      expect(first.headers.get('access-control-allow-origin')).toBeNull();
      await fetch(fwd, { headers: { 'x-agentroom-forward': '1' } });

      expect(seen[0]).toEqual({ origin: proxy.target.origin, cookie: undefined, body: '{"email":"a"}' });
      expect(seen[1]!.cookie).toBe('session=abc');
    } finally {
      proxy.close();
      api.close();
      app.close();
    }
  });
});

describe('proxy port', () => {
  it('is stable per site so the preview keeps its origin (and storage) across restarts', async () => {
    const { preferredPort } = await import('../src/server/preview/proxy.js');
    const a = preferredPort(new URL('http://localhost:4200/x'));
    expect(a).toBe(preferredPort(new URL('http://localhost:4200/other')));
    expect(a).not.toBe(preferredPort(new URL('http://localhost:3000')));
    expect(a).toBeGreaterThanOrEqual(41000);
    expect(a).toBeLessThan(43000);
  });
});
