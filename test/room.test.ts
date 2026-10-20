import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientMessageType, ServerMessageKind, StateType } from '../src/shared/enums.js';
import { TOKEN_HEADER } from '../src/shared/constants.js';
import { RoomService } from '../src/server/room/room.service.js';
import { requireRoomAuth, roomHostGuard } from '../src/server/room/auth.js';
import { hiddenFromMembers, memberMayCall, memberMaySend } from '../src/server/room/access.js';
import { signMemberToken, verifyMemberToken } from '../src/server/room/tokens.js';
import { currentPrincipal, memberLabel } from '../src/server/room/principal.js';
import { roomRoutes } from '../src/server/http/routes/room.routes.js';
import { Hub } from '../src/server/realtime/hub.js';

const OWNER = 'owner-session-token';
const LAN = { incoming: { socket: { remoteAddress: '192.168.1.40' } } };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-room-'));
  let secret = 'host-secret-1';
  let now = Date.parse('2026-10-20T10:00:00Z');
  const listenLan = vi.fn(async () => ({ close: () => {} }));
  const audits: string[] = [];
  const room = new RoomService({
    file: path.join(dir, 'room.json'),
    port: 4317,
    secret: { get: () => secret, rotate: () => void (secret = `rotated-${Math.random()}`) },
    owner: () => ({ name: 'Kinley', email: 'kinley@example.com' }),
    startTunnel: async () => {
      throw new Error('no tunnel in tests');
    },
    listenLan,
    audit: (s) => void audits.push(s),
    interfaces: () => [{ name: 'en0', address: '192.168.1.10' }],
    now: () => now,
  });

  const seen: { who?: string; label?: string }[] = [];
  const app = new Hono();
  app.use('*', roomHostGuard(room));
  const api = new Hono();
  api.use('*', requireRoomAuth(OWNER, room));
  api.get('/goals', (c) => {
    seen.push({ who: currentPrincipal()?.id, label: memberLabel() });
    return c.json([]);
  });
  let n = 0;
  api.post('/goals', (c) => c.json({ id: `G-${++n}` }));
  api.post('/goals/:id/approve', (c) => {
    seen.push({ who: currentPrincipal()?.id, label: memberLabel() });
    return c.json({ ok: true });
  });
  api.post('/goals/:id/cancel', (c) => c.json({ ok: true }));
  api.get('/integrations', (c) => c.json({ slack: true }));
  api.get('/settings', (c) => c.json({}));
  roomRoutes(api, room);
  app.route('/api', api);

  const req = (p: string, init: { method?: string; token?: string; body?: unknown; env?: unknown; headers?: Record<string, string> } = {}) =>
    app.request(
      `/api${p}`,
      {
        method: init.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          host: 'localhost:4317',
          ...(init.token ? { [TOKEN_HEADER]: init.token } : {}),
          ...(init.headers ?? {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      },
      init.env as never,
    );

  const invite = async (role: 'viewer' | 'approver', email = `${role}@example.com`) => {
    const res = await req('/room/members', { method: 'POST', token: OWNER, body: { name: role === 'viewer' ? 'Vera Viewer' : 'Dorji Approver', email, role, days: 7 } });
    expect(res.status).toBe(200);
    const inv = (await res.json()) as { member: { id: string }; links: { local: string } };
    return { id: inv.member.id, token: decodeURIComponent(inv.links.local.split('?t=')[1]!) };
  };

  return {
    room,
    req,
    invite,
    seen,
    audits,
    listenLan,
    advance: (ms: number) => void (now += ms),
    enable: () => req('/room/enable', { method: 'POST', token: OWNER }),
  };
}

describe('member tokens', () => {
  it('signs, verifies and rejects tampering and expiry', () => {
    const t = signMemberToken('k', { m: 'm1', j: 'j1', e: 2_000 });
    expect(verifyMemberToken('k', t, 1_000)).toEqual({ m: 'm1', j: 'j1', e: 2_000 });
    expect(verifyMemberToken('other', t, 1_000)).toBeNull();
    expect(verifyMemberToken('k', t, 3_000)).toBeNull();
    const [p, payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ m: 'm1', j: 'j1', e: 9e15 })).toString('base64url');
    expect(verifyMemberToken('k', `${p}.${forged}.${sig}`, 1_000)).toBeNull();
    expect(verifyMemberToken('k', `${p}.${payload}`, 1_000)).toBeNull();
  });
});

describe('team room auth', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('is off by default; LAN sharing is never on until asked', async () => {
    const st = t.room.status();
    expect(st.enabled).toBe(false);
    expect(st.lan.enabled).toBe(false);
    expect(st.tunnel.state).toBe('off');
    expect(t.listenLan).not.toHaveBeenCalled();
    await expect(t.room.enableLan()).rejects.toThrow(/Turn the team room on first/);
    await t.enable();
    expect(t.room.status().lan.enabled).toBe(false);
    await t.room.enableLan('192.168.1.10');
    expect(t.listenLan).toHaveBeenCalledWith('192.168.1.10');
    expect(t.room.status().lan.url).toBe('http://192.168.1.10:4317');
    await expect(t.room.enableLan('10.9.9.9')).rejects.toThrow(/isn't one of this machine's network addresses/);
  });

  it('accepts the owner token only on this machine', async () => {
    expect((await t.req('/goals', { token: OWNER })).status).toBe(200);
    // Through the tunnel (Cloudflare headers) or from another machine: refused.
    expect((await t.req('/goals', { token: OWNER, headers: { 'cf-ray': 'x' } })).status).toBe(401);
    await t.enable();
    await t.room.enableLan('192.168.1.10');
    expect((await t.req('/goals', { token: OWNER, env: LAN, headers: { host: '192.168.1.10:4317' } })).status).toBe(401);
  });

  it('refuses member links while the room is off', async () => {
    await t.enable();
    const v = await t.invite('viewer');
    expect((await t.req('/goals', { token: v.token })).status).toBe(200);
    await t.req('/room/disable', { method: 'POST', token: OWNER });
    expect((await t.req('/goals', { token: v.token })).status).toBe(401);
  });

  it('viewers read but cannot approve or reach owner-only data', async () => {
    await t.enable();
    const v = await t.invite('viewer');
    expect((await t.req('/goals', { token: v.token })).status).toBe(200);
    expect(t.seen.at(-1)).toEqual({ who: v.id, label: 'Vera Viewer <viewer@example.com>' });
    const approve = await t.req('/goals/G-1/approve', { method: 'POST', token: v.token });
    expect(approve.status).toBe(403);
    expect((await t.req('/goals', { method: 'POST', token: v.token, body: { brief: 'x' } })).status).toBe(403);
    expect((await t.req('/integrations', { token: v.token })).status).toBe(403);
    expect((await t.req('/room', { token: v.token })).status).toBe(403);
    expect((await t.req('/room/members', { method: 'POST', token: v.token, body: { name: 'x', email: 'x@y.z' } })).status).toBe(403);
    expect((await t.req('/room/comments', { method: 'POST', token: v.token, body: { goalId: 'G-1', body: 'hi' } })).status).toBe(403);
  });

  it('approvers approve as themselves, and only cancel goals they started', async () => {
    await t.enable();
    const a = await t.invite('approver');
    const res = await t.req('/goals/G-9/approve', { method: 'POST', token: a.token });
    expect(res.status).toBe(200);
    expect(t.seen.at(-1)).toEqual({ who: a.id, label: 'Dorji Approver <approver@example.com>' });
    expect((await t.req('/integrations', { token: a.token })).status).toBe(403);
    // Someone else's goal: no.
    const owners = await t.req('/goals', { method: 'POST', token: OWNER, body: { brief: 'owner goal' } });
    const ownerGoal = ((await owners.json()) as { id: string }).id;
    expect((await t.req(`/goals/${ownerGoal}/cancel`, { method: 'POST', token: a.token })).status).toBe(403);
    // Their own goal: yes.
    const mine = await t.req('/goals', { method: 'POST', token: a.token, body: { brief: 'my goal' } });
    const myGoal = ((await mine.json()) as { id: string }).id;
    expect(t.room.goalOwners()[myGoal]).toMatchObject({ id: a.id, email: 'approver@example.com' });
    expect((await t.req(`/goals/${myGoal}/cancel`, { method: 'POST', token: a.token })).status).toBe(200);
  });

  it('role changes apply immediately', async () => {
    await t.enable();
    const v = await t.invite('viewer');
    expect((await t.req('/goals/G-1/approve', { method: 'POST', token: v.token })).status).toBe(403);
    await t.req(`/room/members/${v.id}`, { method: 'PATCH', token: OWNER, body: { role: 'approver' } });
    expect((await t.req('/goals/G-1/approve', { method: 'POST', token: v.token })).status).toBe(200);
  });

  it('rejects revoked, replaced and expired links', async () => {
    await t.enable();
    const v = await t.invite('viewer');
    const r = await t.req(`/room/members/${v.id}/link`, { method: 'POST', token: OWNER, body: {} });
    const fresh = decodeURIComponent(((await r.json()) as { links: { local: string } }).links.local.split('?t=')[1]!);
    expect((await t.req('/goals', { token: v.token })).status).toBe(401);
    expect((await t.req('/goals', { token: fresh })).status).toBe(200);
    await t.req(`/room/members/${v.id}`, { method: 'DELETE', token: OWNER });
    expect((await t.req('/goals', { token: fresh })).status).toBe(401);

    const a = await t.invite('approver');
    expect((await t.req('/goals', { token: a.token })).status).toBe(200);
    t.advance(8 * 86_400_000);
    expect((await t.req('/goals', { token: a.token })).status).toBe(401);
  });

  it('rotating the signing key invalidates every link', async () => {
    await t.enable();
    const v = await t.invite('viewer');
    await t.req('/room/rotate', { method: 'POST', token: OWNER });
    expect((await t.req('/goals', { token: v.token })).status).toBe(401);
  });

  it('rate-limits failed sign-ins', async () => {
    for (let i = 0; i < 20; i++) expect((await t.req('/goals', { token: 'nope' })).status).toBe(401);
    expect((await t.req('/goals', { token: 'nope' })).status).toBe(429);
    // Even the right token waits out the window from that source.
    expect((await t.req('/goals', { token: OWNER })).status).toBe(429);
    t.advance(61_000);
    expect((await t.req('/goals', { token: OWNER })).status).toBe(200);
  });

  it('refuses cross-site member requests', async () => {
    await t.enable();
    const a = await t.invite('approver');
    const res = await t.req('/goals/G-1/approve', { method: 'POST', token: a.token, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('LAN requests must name the bound address (DNS-rebinding guard)', async () => {
    await t.enable();
    const v = await t.invite('viewer');
    // LAN not shared yet: refused.
    expect((await t.req('/goals', { token: v.token, env: LAN, headers: { host: '192.168.1.10:4317' } })).status).toBe(421);
    await t.room.enableLan('192.168.1.10');
    expect((await t.req('/goals', { token: v.token, env: LAN, headers: { host: 'evil.example:4317' } })).status).toBe(421);
    expect((await t.req('/goals', { token: v.token, env: LAN, headers: { host: '192.168.1.10:4317' } })).status).toBe(200);
  });

  it('comments notify mentioned people and the goal starter; only authors delete', async () => {
    await t.enable();
    const a = await t.invite('approver');
    const b = await t.invite('approver', 'pema@example.com');
    const res = await t.req('/room/comments', { method: 'POST', token: a.token, body: { goalId: 'G-3', target: 'plan', body: 'Looks good. @Kinley can you check step 2? cc @pema' } });
    expect(res.status).toBe(200);
    const comment = (await res.json()) as { id: string; mentions: string[]; target: string };
    expect(comment.target).toBe('plan');
    expect(comment.mentions.sort()).toEqual(['owner', b.id].sort());
    const mine = (await (await t.req('/room/notifications', { token: OWNER })).json()) as { kind: string }[];
    expect(mine.map((n) => n.kind)).toEqual(['mention']);
    const theirs = (await (await t.req('/room/notifications', { token: b.token })).json()) as unknown[];
    expect(theirs).toHaveLength(1);
    expect((await t.req(`/room/comments/${comment.id}`, { method: 'DELETE', token: b.token })).status).toBe(403);
    expect((await t.req(`/room/comments/${comment.id}`, { method: 'DELETE', token: a.token })).status).toBe(200);
  });

  it('never lists tokens or the signing key', async () => {
    await t.enable();
    await t.invite('viewer');
    const st = JSON.stringify(await (await t.req('/room', { token: OWNER })).json());
    expect(st).not.toContain('tokenId');
    expect(st).not.toContain('host-secret');
  });
});

describe('access policy', () => {
  it('defaults to deny', () => {
    const owns = () => false;
    expect(memberMayCall('viewer', 'GET', '/goals', owns)).toBe(true);
    expect(memberMayCall('viewer', 'GET', '/mcp', owns)).toBe(false);
    expect(memberMayCall('viewer', 'GET', '/automation', owns)).toBe(false);
    expect(memberMayCall('approver', 'PATCH', '/settings', owns)).toBe(false);
    expect(memberMayCall('approver', 'POST', '/goals/G-1/pr', owns)).toBe(false);
    expect(memberMayCall('approver', 'POST', '/goals/G-1/merge-local', owns)).toBe(false);
    expect(memberMayCall('approver', 'PUT', '/sentry/token', owns)).toBe(false);
    expect(memberMayCall('approver', 'POST', '/goals/G-1/approve', owns)).toBe(true);

  });

  it('lets members read the multi-repo workspace map but only the owner sync it', () => {
    const owns = () => false;
    for (const role of ['viewer', 'approver'] as const) {
      expect(memberMayCall(role, 'GET', '/workspace', owns)).toBe(true);
      expect(memberMayCall(role, 'GET', '/workspace/graph', owns)).toBe(true);
      expect(memberMayCall(role, 'GET', '/workspace/edges', owns)).toBe(true);
      expect(memberMayCall(role, 'POST', '/workspace/sync', owns)).toBe(false);
    }
    expect(memberMayCall('owner', 'POST', '/workspace/sync', owns)).toBe(true);
  });

  it('limits WebSocket messages', () => {
    expect(memberMaySend('viewer', ClientMessageType.Permission)).toBe(false);
    expect(memberMaySend('viewer', ClientMessageType.Send)).toBe(false);
    expect(memberMaySend('viewer', ClientMessageType.Presence)).toBe(true);
    expect(memberMaySend('approver', ClientMessageType.Permission)).toBe(true);
    for (const role of ['viewer', 'approver'] as const) {
      expect(memberMaySend(role, ClientMessageType.BridgeResult)).toBe(false);
      expect(memberMaySend(role, ClientMessageType.BrowserOpen)).toBe(false);
      expect(memberMaySend(role, ClientMessageType.NotificationsRead)).toBe(false);
      expect(memberMaySend(role, ClientMessageType.Focus)).toBe(false);
    }
  });

  it('hub keeps members off the bridge and private pushes', () => {
    const hub = new Hub(fs.mkdtempSync(path.join(os.tmpdir(), 'ar-hub-')));
    const guestMsgs: string[] = [];
    const ownerMsgs: string[] = [];
    const guest = { send: (d: string) => void guestMsgs.push(d), guest: true };
    const owner = { send: (d: string) => void ownerMsgs.push(d) };
    hub.add(guest);
    expect(hub.hasUi).toBe(false);
    expect(hub.toPrimary({ kind: ServerMessageKind.Account, account: null })).toBe(false);
    hub.focus(guest);
    hub.setPresence(guest, true);
    expect(hub.isActive).toBe(false);
    hub.add(owner);
    expect(hub.hasUi).toBe(true);
    hub.setAccount(null);
    hub.state({ type: StateType.Mcp, mcp: null as never });
    hub.state({ type: StateType.Goals, goals: [] });
    const kinds = (list: string[]) => list.map((d) => JSON.parse(d) as { kind: string; event?: { type: string } }).map((m) => m.event?.type ?? m.kind);
    expect(kinds(guestMsgs)).toEqual(['hello', StateType.Goals]);
    expect(kinds(ownerMsgs)).toEqual(['hello', 'account', StateType.Mcp, StateType.Goals]);
    expect(hiddenFromMembers({ kind: ServerMessageKind.State, event: { type: StateType.Automation, automation: null as never } })).toBe(true);
  });
});
