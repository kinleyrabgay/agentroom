import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { ServerMessageKind } from '../../shared/enums.js';
import type {
  RoomComment,
  RoomCommentTarget,
  RoomGoalOwners,
  RoomIdentity,
  RoomInvite,
  RoomMe,
  RoomMember,
  RoomMemberView,
  RoomNotification,
  RoomPresence,
  RoomPush,
  RoomRole,
  RoomStatus,
  RoomTunnelStatus,
} from '../../shared/types/index.js';
import { readJson } from '../../core/fs/json.js';
import { TunnelError, type StartTunnel, type Tunnel } from '../remote/tunnel.js';
import type { Principal } from './principal.js';
import { signMemberToken, verifyMemberToken } from './tokens.js';

/** Allowed link lifetimes (days). */
export const ROOM_DAYS = [1, 7, 30, 90] as const;
export const DEFAULT_ROOM_DAYS = 7;
const MAX_MEMBERS = 50;
const MAX_COMMENTS = 5000;
const MAX_NOTIFICATIONS = 1000;
const COMMENT_MAX = 4000;
const FAIL_WINDOW_MS = 60_000;
const FAIL_MAX = 20;
const REQ_WINDOW_MS = 60_000;
const REQ_MAX = 600;
const SEEN_WRITE_MS = 60_000;
const FILE_MODE = 0o600;

/** A connected UI (owner tab or member tab). */
export interface RoomClient {
  send(data: string): void;
}

export interface RoomDeps {
  /** `runs/room.json` (local: members, comments, notifications). */
  file: string;
  port: number;
  /** Host secret for signing links (runs/secrets.json). */
  secret: { get(): string; rotate(): void };
  /** The owner's git identity. */
  owner: () => { name: string; email: string };
  startTunnel: StartTunnel;
  /** Start an extra listener on a LAN address (same app, same port). */
  listenLan: (address: string) => Promise<{ close(): void }>;
  audit: (summary: string, detail?: Record<string, unknown>) => void;
  /** Non-internal IPv4 interfaces (overridable in tests). */
  interfaces?: () => { name: string; address: string }[];
  now?: () => number;
}

interface RoomFile {
  enabled: boolean;
  members: RoomMember[];
  comments: RoomComment[];
  notifications: RoomNotification[];
  goalOwners: RoomGoalOwners;
}

const EMPTY: RoomFile = { enabled: false, members: [], comments: [], notifications: [], goalOwners: {} };

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Shared team room. Opt-in: teammates join this AgentRoom with a personal, signed, expiring link
 * over the LAN (an extra listener, only while you turn it on) or a Cloudflare tunnel.
 * Roles are enforced on the server (see access.ts); this machine executes everything.
 */
export class RoomService {
  private data: RoomFile;
  private lan: { address: string; close(): void } | null = null;
  private lanError: string | undefined;
  private tunnel: Tunnel | null = null;
  private tunnelState: RoomTunnelStatus = { state: 'off' };
  private clients = new Map<RoomClient, { principal: Principal; active: boolean; since: string }>();
  private fails = new Map<string, number[]>();
  private hits = new Map<string, number[]>();
  private seenWritten = new Map<string, number>();

  constructor(private readonly deps: RoomDeps) {
    const raw = readJson<Partial<RoomFile>>(deps.file, {});
    this.data = {
      enabled: raw.enabled === true,
      members: Array.isArray(raw.members) ? raw.members : [],
      comments: Array.isArray(raw.comments) ? raw.comments : [],
      notifications: Array.isArray(raw.notifications) ? raw.notifications : [],
      goalOwners: raw.goalOwners && typeof raw.goalOwners === 'object' ? raw.goalOwners : {},
    };
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  private save() {
    fs.mkdirSync(path.dirname(this.deps.file), { recursive: true });
    fs.writeFileSync(this.deps.file, JSON.stringify(this.data, null, 2) + '\n', { mode: FILE_MODE });
  }

  // ---------- status ----------

  get enabled() {
    return this.data.enabled;
  }

  ownerIdentity(): RoomIdentity {
    const o = this.deps.owner();
    return { id: 'owner', name: o.name, email: o.email, role: 'owner' };
  }

  interfaces() {
    if (this.deps.interfaces) return this.deps.interfaces();
    const out: { name: string; address: string }[] = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
    }
    return out;
  }

  /** The LAN address members may use as Host (DNS-rebinding guard), when the LAN listener is on. */
  lanHost(): string | null {
    return this.lan ? `${this.lan.address}:${this.deps.port}` : null;
  }

  /** Host of the room tunnel, when on. */
  tunnelHost(): string | null {
    return this.tunnelState.state === 'on' && this.tunnelState.url ? new URL(this.tunnelState.url).host : null;
  }

  /** Requests through Cloudflare may reach the UI and API only while the room tunnel is on. */
  tunnelOpen(): boolean {
    return this.data.enabled && this.tunnelState.state === 'on';
  }

  status(): RoomStatus {
    return {
      enabled: this.data.enabled,
      port: this.deps.port,
      lan: {
        enabled: !!this.lan,
        ...(this.lan ? { address: this.lan.address, url: `http://${this.lan.address}:${this.deps.port}` } : {}),
        ...(this.lanError ? { error: this.lanError } : {}),
        interfaces: this.interfaces(),
      },
      tunnel: { ...this.tunnelState },
      members: this.data.members.map((m) => this.view(m)),
      owner: this.deps.owner(),
    };
  }

  private memberState(m: RoomMember): RoomMemberView['state'] {
    if (m.revokedAt) return 'revoked';
    return Date.parse(m.expiresAt) <= this.now() ? 'expired' : 'active';
  }

  private view(m: RoomMember): RoomMemberView {
    const { tokenId: _t, ...rest } = m;
    return { ...rest, state: this.memberState(m), online: [...this.clients.values()].some((c) => c.principal.id === m.id) };
  }

  // ---------- sharing on/off ----------

  setEnabled(on: boolean): RoomStatus {
    if (this.data.enabled === on) return this.status();
    this.data.enabled = on;
    this.save();
    if (!on) {
      this.disableLan(false);
      this.disableTunnel(false);
      this.kickMembers();
    }
    this.deps.audit(on ? 'Team room turned on' : 'Team room turned off');
    return this.status();
  }

  async enableLan(address?: string): Promise<RoomStatus> {
    if (!this.data.enabled) throw new RoomError('Turn the team room on first.');
    const ifaces = this.interfaces();
    const pick = address ? ifaces.find((i) => i.address === address) : ifaces[0];
    if (!pick) throw new RoomError(address ? `${address} isn't one of this machine's network addresses.` : 'No network connection found to share on.');
    this.disableLan(false);
    try {
      const listener = await this.deps.listenLan(pick.address);
      this.lan = { address: pick.address, close: () => listener.close() };
      this.lanError = undefined;
      this.deps.audit(`Team room shared on the local network (${pick.address}:${this.deps.port})`);
    } catch (err) {
      this.lanError = (err as Error).message;
    }
    return this.status();
  }

  disableLan(audit = true): RoomStatus {
    if (this.lan) {
      this.lan.close();
      this.lan = null;
      if (audit) this.deps.audit('Team room stopped sharing on the local network');
    }
    return this.status();
  }

  async enableTunnel(): Promise<RoomStatus> {
    if (!this.data.enabled) throw new RoomError('Turn the team room on first.');
    this.disableTunnel(false);
    this.tunnelState = { state: 'starting' };
    try {
      const tunnel = await this.deps.startTunnel(this.deps.port);
      this.tunnel = tunnel;
      this.tunnelState = { state: 'on', url: tunnel.url };
      tunnel.onExit(() => {
        if (this.tunnel !== tunnel) return;
        this.tunnel = null;
        this.tunnelState = { state: 'error', error: 'The tunnel closed. Turn it on again.' };
      });
      this.deps.audit('Team room shared through a Cloudflare tunnel', { url: tunnel.url });
    } catch (err) {
      const missing = err instanceof TunnelError && err.missingBinary;
      this.tunnelState = { state: 'error', error: (err as Error).message, ...(missing ? { missingBinary: true } : {}) };
    }
    return this.status();
  }

  disableTunnel(audit = true): RoomStatus {
    if (this.tunnel) {
      this.tunnel.stop();
      this.tunnel = null;
      if (audit) this.deps.audit('Team room tunnel turned off');
    }
    this.tunnelState = { state: 'off' };
    return this.status();
  }

  // ---------- members ----------

  async invite(input: { name?: unknown; email?: unknown; role?: unknown; days?: unknown }): Promise<RoomInvite> {
    const name = String(input.name ?? '').trim().slice(0, 80);
    const email = String(input.email ?? '').trim().toLowerCase().slice(0, 200);
    const role = input.role === 'approver' ? 'approver' : input.role === 'viewer' || input.role === undefined ? 'viewer' : null;
    const days = input.days === undefined ? DEFAULT_ROOM_DAYS : Number(input.days);
    if (!name) throw new RoomError('Add their name.');
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new RoomError('Add their git email (name@company.com).');
    if (!role) throw new RoomError('Role must be approver or viewer.');
    if (!(ROOM_DAYS as readonly number[]).includes(days)) throw new RoomError(`Pick ${ROOM_DAYS.join(', ')} days.`);
    if (email === this.deps.owner().email.toLowerCase()) throw new RoomError("That's your own email; you're already the owner.");
    const live = this.data.members.filter((m) => !m.revokedAt);
    if (live.some((m) => m.email === email)) throw new RoomError(`${email} is already in the room. Issue a new link from their row instead.`);
    if (live.length >= MAX_MEMBERS) throw new RoomError(`A room holds up to ${MAX_MEMBERS} people.`);
    const member: RoomMember = {
      id: `m_${randomBytes(6).toString('hex')}`,
      name,
      email,
      role,
      createdAt: this.iso(),
      expiresAt: new Date(this.now() + days * 86_400_000).toISOString(),
      tokenId: randomBytes(9).toString('base64url'),
    };
    this.data.members.push(member);
    this.save();
    this.deps.audit(`Invited ${name} <${email}> to the team room as ${role}`, { days });
    return this.links(member);
  }

  /** New link for a member (the old one stops working). Optionally extend expiry. */
  async reissue(id: string, days?: unknown): Promise<RoomInvite> {
    const m = this.member(id);
    if (m.revokedAt) throw new RoomError('This person was removed. Invite them again.');
    if (days !== undefined) {
      const d = Number(days);
      if (!(ROOM_DAYS as readonly number[]).includes(d)) throw new RoomError(`Pick ${ROOM_DAYS.join(', ')} days.`);
      m.expiresAt = new Date(this.now() + d * 86_400_000).toISOString();
    }
    m.tokenId = randomBytes(9).toString('base64url');
    this.save();
    this.kick(m.id);
    this.deps.audit(`New team room link for ${m.name} <${m.email}>`);
    return this.links(m);
  }

  setRole(id: string, role: unknown): RoomMemberView {
    const m = this.member(id);
    if (role !== 'approver' && role !== 'viewer') throw new RoomError('Role must be approver or viewer.');
    if (m.role !== role) {
      m.role = role;
      this.save();
      this.deps.audit(`Changed ${m.name} <${m.email}> to ${role} in the team room`);
      for (const [client, c] of this.clients) if (c.principal.id === m.id) c.principal = { ...c.principal, role };
      this.pushMe(m.id);
      this.pushPresence();
    }
    return this.view(m);
  }

  revoke(id: string): RoomMemberView {
    const m = this.member(id);
    if (!m.revokedAt) {
      m.revokedAt = this.iso();
      this.save();
      this.kick(m.id);
      this.deps.audit(`Removed ${m.name} <${m.email}> from the team room`);
    }
    return this.view(m);
  }

  /** New host secret: every member link stops working at once. */
  rotate(): RoomStatus {
    this.deps.secret.rotate();
    this.kickMembers();
    this.deps.audit('Team room links reset (new signing key)');
    return this.status();
  }

  private member(id: string): RoomMember {
    const m = this.data.members.find((x) => x.id === id);
    if (!m) throw new RoomError('No such member.', 404);
    return m;
  }

  private async links(m: RoomMember): Promise<RoomInvite> {
    const token = signMemberToken(this.deps.secret.get(), { m: m.id, j: m.tokenId, e: Date.parse(m.expiresAt) });
    const q = `/?t=${encodeURIComponent(token)}`;
    const links: RoomInvite['links'] = { local: `http://localhost:${this.deps.port}${q}` };
    if (this.lan) links.lan = `http://${this.lan.address}:${this.deps.port}${q}`;
    if (this.tunnelState.state === 'on' && this.tunnelState.url) links.tunnel = `${this.tunnelState.url}${q}`;
    const best = links.tunnel ?? links.lan;
    return { member: this.view(m), links, ...(best ? { qrSvg: await QRCode.toString(best, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) } : {}) };
  }

  // ---------- authentication ----------

  /** The member behind a link token, if the room is on and the link is current. */
  authenticate(token: string | undefined): Principal | null {
    if (!this.data.enabled) return null;
    const claims = verifyMemberToken(this.deps.secret.get(), token, this.now());
    if (!claims) return null;
    const m = this.data.members.find((x) => x.id === claims.m);
    if (!m || m.revokedAt || m.tokenId !== claims.j || Date.parse(m.expiresAt) <= this.now()) return null;
    this.touch(m);
    return { kind: 'member', id: m.id, name: m.name, email: m.email, role: m.role };
  }

  /** The member's current record still allows access (checked on every WS message). */
  stillValid(p: Principal): boolean {
    if (p.kind === 'owner') return true;
    if (!this.data.enabled) return false;
    const m = this.data.members.find((x) => x.id === p.id);
    return !!m && !m.revokedAt && Date.parse(m.expiresAt) > this.now();
  }

  /** Current role (role changes apply immediately, without a new link). */
  roleOf(p: Principal): RoomRole {
    if (p.kind === 'owner') return 'owner';
    return this.data.members.find((x) => x.id === p.id)?.role ?? 'viewer';
  }

  private touch(m: RoomMember) {
    const last = this.seenWritten.get(m.id) ?? 0;
    if (this.now() - last < SEEN_WRITE_MS) return;
    this.seenWritten.set(m.id, this.now());
    m.lastSeenAt = this.iso();
    this.save();
  }

  /** Failed sign-ins per source; false once the source is over the limit. */
  noteFailure(source: string): boolean {
    return this.window(this.fails, source, FAIL_WINDOW_MS, FAIL_MAX);
  }

  /** True while a source is blocked for too many failed sign-ins. */
  blocked(source: string): boolean {
    const t = this.now();
    return (this.fails.get(source) ?? []).filter((x) => t - x < FAIL_WINDOW_MS).length >= FAIL_MAX;
  }

  /** Requests per member; false once over the limit. */
  allowRequest(memberId: string): boolean {
    return this.window(this.hits, memberId, REQ_WINDOW_MS, REQ_MAX);
  }

  private window(map: Map<string, number[]>, key: string, ms: number, max: number): boolean {
    const t = this.now();
    const list = (map.get(key) ?? []).filter((x) => t - x < ms);
    list.push(t);
    map.set(key, list);
    if (map.size > 5000) map.clear();
    return list.length <= max;
  }

  // ---------- presence ----------

  attach(client: RoomClient, principal: Principal) {
    this.clients.set(client, { principal, active: false, since: this.iso() });
    this.sendTo(client, { type: 'me', me: this.me(principal) });
    this.sendTo(client, { type: 'goal-owners', owners: this.data.goalOwners });
    this.pushPresence();
  }

  detach(client: RoomClient) {
    if (this.clients.delete(client)) this.pushPresence();
  }

  setActive(client: RoomClient, active: boolean) {
    const c = this.clients.get(client);
    if (!c || c.active === active) return;
    c.active = active;
    this.pushPresence();
  }

  principalOf(client: RoomClient): Principal | undefined {
    return this.clients.get(client)?.principal;
  }

  /** Everyone connected now (one entry per person). */
  presence(): RoomPresence[] {
    const by = new Map<string, RoomPresence>();
    for (const { principal: p, active, since } of this.clients.values()) {
      const prev = by.get(p.id);
      const role = this.roleOf(p);
      if (!prev) by.set(p.id, { id: p.id, name: p.name, email: p.email, role, active, since });
      else by.set(p.id, { ...prev, active: prev.active || active, since: prev.since < since ? prev.since : since });
    }
    return [...by.values()].sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.since.localeCompare(b.since)));
  }

  me(p: Principal): RoomMe {
    if (p.kind === 'owner') return { ...this.ownerIdentity(), roomEnabled: this.data.enabled };
    const m = this.data.members.find((x) => x.id === p.id);
    return { id: p.id, name: p.name, email: p.email, role: this.roleOf(p), roomEnabled: this.data.enabled, ...(m ? { expiresAt: m.expiresAt } : {}) };
  }

  private pushPresence() {
    this.broadcast({ type: 'presence', online: this.presence() });
  }

  private pushMe(memberId: string) {
    for (const [client, c] of this.clients) if (c.principal.id === memberId) this.sendTo(client, { type: 'me', me: this.me(c.principal) });
  }

  private kick(memberId: string) {
    for (const [client, c] of this.clients) {
      if (c.principal.id !== memberId) continue;
      this.clients.delete(client);
      (client as RoomClient & { close?: () => void }).close?.();
    }
    this.pushPresence();
  }

  private kickMembers() {
    for (const [client, c] of this.clients) {
      if (c.principal.kind !== 'member') continue;
      this.clients.delete(client);
      (client as RoomClient & { close?: () => void }).close?.();
    }
    this.pushPresence();
  }

  private sendTo(client: RoomClient, room: RoomPush) {
    try {
      client.send(JSON.stringify({ kind: ServerMessageKind.Room, room }));
    } catch {
      this.clients.delete(client);
    }
  }

  private broadcast(room: RoomPush, only?: (p: Principal) => boolean) {
    for (const [client, c] of this.clients) if (!only || only(c.principal)) this.sendTo(client, room);
  }

  // ---------- goals ----------

  goalOwners(): RoomGoalOwners {
    return this.data.goalOwners;
  }

  /** Record who started a goal (only while the room is on, so solo use stays untouched). */
  setGoalOwner(goalId: string, p: Principal) {
    if (!this.data.enabled || !goalId) return;
    this.data.goalOwners[goalId] = { id: p.id, name: p.name, email: p.email };
    this.save();
    this.broadcast({ type: 'goal-owners', owners: this.data.goalOwners });
  }

  ownsGoal(goalId: string, p: Principal): boolean {
    return p.kind === 'owner' || this.data.goalOwners[goalId]?.id === p.id;
  }

  // ---------- comments ----------

  comments(goalId?: string): RoomComment[] {
    return goalId ? this.data.comments.filter((c) => c.goalId === goalId) : this.data.comments.slice(-200);
  }

  addComment(p: Principal, input: { goalId?: unknown; target?: unknown; body?: unknown }): RoomComment {
    const goalId = String(input.goalId ?? '').trim();
    const body = String(input.body ?? '').trim();
    const target: RoomCommentTarget = input.target === 'plan' ? 'plan' : 'goal';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(goalId)) throw new RoomError('Which goal is this about?');
    if (!body) throw new RoomError('Write a comment first.');
    if (body.length > COMMENT_MAX) throw new RoomError(`Comments can be up to ${COMMENT_MAX} characters.`);
    const author: RoomIdentity = { id: p.id, name: p.name, email: p.email, role: this.roleOf(p) };
    const mentions = this.mentions(body).filter((id) => id !== p.id);
    const comment: RoomComment = { id: randomUUID(), goalId, target, author, body, mentions, createdAt: this.iso() };
    this.data.comments.push(comment);
    if (this.data.comments.length > MAX_COMMENTS) this.data.comments.splice(0, this.data.comments.length - MAX_COMMENTS);

    // Notify: everyone mentioned, plus whoever started the goal (or the owner) when someone else comments.
    const notify = new Map<string, RoomNotification['kind']>();
    for (const id of mentions) notify.set(id, 'mention');
    const starter = this.data.goalOwners[goalId]?.id ?? 'owner';
    if (starter !== p.id && !notify.has(starter)) notify.set(starter, 'comment');
    const excerpt = body.length > 140 ? `${body.slice(0, 139)}…` : body;
    for (const [to, kind] of notify) {
      const n: RoomNotification = { id: randomUUID(), to, kind, goalId, commentId: comment.id, from: p.name, text: excerpt, createdAt: comment.createdAt, read: false };
      this.data.notifications.push(n);
      this.broadcast({ type: 'notification', notification: n }, (x) => x.id === to);
    }
    if (this.data.notifications.length > MAX_NOTIFICATIONS) this.data.notifications.splice(0, this.data.notifications.length - MAX_NOTIFICATIONS);
    this.save();
    this.broadcast({ type: 'comment', comment });
    return comment;
  }

  removeComment(p: Principal, id: string): { ok: true } {
    const i = this.data.comments.findIndex((c) => c.id === id);
    if (i < 0) throw new RoomError('No such comment.', 404);
    const comment = this.data.comments[i]!;
    if (p.kind !== 'owner' && comment.author.id !== p.id) throw new RoomError('You can only delete your own comments.', 403);
    this.data.comments.splice(i, 1);
    this.data.notifications = this.data.notifications.filter((n) => n.commentId !== id);
    this.save();
    this.broadcast({ type: 'comment', comment, removed: true });
    return { ok: true };
  }

  /** Member ids (or `owner`) for every `@name` in the text: full name, first name, or email name. */
  private mentions(body: string): string[] {
    const people = [this.ownerIdentity(), ...this.data.members.filter((m) => this.memberState(m) === 'active')];
    const text = body.toLowerCase();
    const out = new Set<string>();
    for (const person of people) {
      const handles = new Set([person.name.toLowerCase(), person.name.split(/\s+/)[0]!.toLowerCase(), person.email.split('@')[0]!.toLowerCase()].filter(Boolean));
      for (const h of handles) {
        const re = new RegExp(`(^|[^\\w@])@${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
        if (re.test(text)) out.add(person.id);
      }
    }
    return [...out];
  }

  // ---------- notifications ----------

  notifications(p: Principal): RoomNotification[] {
    return this.data.notifications.filter((n) => n.to === p.id).slice(-100);
  }

  markRead(p: Principal, ids: unknown): { ok: true } {
    const set = new Set(Array.isArray(ids) ? ids.map(String) : []);
    let changed = false;
    for (const n of this.data.notifications) {
      if (n.to === p.id && !n.read && (set.size === 0 || set.has(n.id))) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) this.save();
    return { ok: true };
  }

  close() {
    this.disableLan(false);
    this.disableTunnel(false);
  }
}

/** Host secret helpers over runs/secrets.json. */
export function roomSecret(store: { read(): { roomSecret?: string }; setRoomSecret(v: string): void }) {
  return {
    get() {
      const s = store.read().roomSecret;
      if (s) return s;
      const fresh = randomBytes(32).toString('base64url');
      store.setRoomSecret(fresh);
      return fresh;
    },
    rotate() {
      store.setRoomSecret(randomBytes(32).toString('base64url'));
    },
  };
}
