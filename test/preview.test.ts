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
