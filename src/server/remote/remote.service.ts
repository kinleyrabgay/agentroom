import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ActorType, AuditKind, GoalStatus, NotificationKind } from '../../shared/enums.js';
import type { AuditActor, Bot, Goal, Notification, RemotePending, RemoteStatus, Task } from '../../shared/types/index.js';
import { TunnelError, type StartTunnel, type Tunnel } from './tunnel.js';

/** Allowed link lifetimes (hours). */
export const REMOTE_HOURS = [1, 4, 8, 24] as const;
export const DEFAULT_REMOTE_HOURS = 8;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

export interface RemoteDeps {
  port: number;
  startTunnel: StartTunnel;
  bots: () => Bot[];
  gate: {
    pendingRequests(): { requestId: string; botId: string; tool: string; summary: string; held: boolean }[];
    resolve(requestId: string, allow: boolean, always?: boolean, actor?: AuditActor): void;
  };
  notifications: { list(): Notification[]; answer(id: string, answer: string): void };
  goals: { list(): Goal[]; approve(id: string): Goal; replan(id: string, feedback: string): Goal };
  tasks: () => Task[];
  audit: (e: { kind: AuditKind; actor: AuditActor; summary: string; goalId?: string; botId?: string; decision?: 'allowed' | 'denied' }) => void;
  /** Reason text of a pending permission request (from the live events). */
  reasonOf?: (requestId: string) => string | undefined;
  /** Notify the UI that the status changed. */
  changed?: () => void;
  now?: () => number;
}

const ACTOR: AuditActor = { type: ActorType.Remote, name: 'phone' };

/**
 * Approve from your phone: an opt-in Cloudflare quick tunnel plus a separate, expiring token.
 * The phone can only see what's waiting on the human and answer it; nothing else is reachable.
 */
export class RemoteService {
  private state: RemoteStatus = { state: 'off' };
  private token: string | null = null;
  private tunnel: Tunnel | null = null;
  private expiry: NodeJS.Timeout | null = null;
  private hits = new Map<string, number[]>();

  constructor(private readonly deps: RemoteDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  /** Status for the local UI; includes the phone link while on. */
  status(): RemoteStatus {
    return { ...this.state, ...(this.state.state === 'on' && this.token && this.state.url ? { link: `${this.state.url}/m?r=${this.token}` } : {}) };
  }

  async enable(hours: number = DEFAULT_REMOTE_HOURS): Promise<RemoteStatus> {
    if (!(REMOTE_HOURS as readonly number[]).includes(hours)) throw new Error(`Pick ${REMOTE_HOURS.join(', ')} hours.`);
    this.disable(false);
    this.state = { state: 'starting' };
    this.deps.changed?.();
    try {
      const tunnel = await this.deps.startTunnel(this.deps.port);
      this.tunnel = tunnel;
      this.token = randomBytes(24).toString('base64url');
      const expiresAt = new Date(this.now() + hours * 3600_000).toISOString();
      this.state = { state: 'on', url: tunnel.url, expiresAt };
      this.expiry = setTimeout(() => this.disable(), hours * 3600_000);
      this.expiry.unref?.();
      tunnel.onExit(() => {
        if (this.tunnel === tunnel) {
          this.clear();
          this.state = { state: 'error', error: 'The tunnel closed. Turn it on again.' };
          this.deps.changed?.();
        }
      });
      this.deps.audit({ kind: AuditKind.Settings, actor: { type: ActorType.Human, name: 'human' }, summary: `Phone approvals turned on for ${hours}h` });
    } catch (err) {
      this.clear();
      const missing = err instanceof TunnelError && err.missingBinary;
      this.state = { state: 'error', error: (err as Error).message, ...(missing ? { missingBinary: true } : {}) };
    }
    this.deps.changed?.();
    return this.status();
  }

  /** Revoke: stop the tunnel and forget the token. */
  disable(notify = true): RemoteStatus {
    const wasOn = this.state.state === 'on';
    this.clear();
    this.state = { state: 'off' };
    if (notify) {
      if (wasOn) this.deps.audit({ kind: AuditKind.Settings, actor: { type: ActorType.Human, name: 'human' }, summary: 'Phone approvals turned off' });
      this.deps.changed?.();
    }
    return this.status();
  }

  private clear() {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.tunnel?.stop();
    this.tunnel = null;
    this.token = null;
  }

  /** A remote token is valid only while on, before expiry, and only for remote endpoints. */
  validate(provided: string | undefined | null): boolean {
    if (!provided || !this.token || this.state.state !== 'on') return false;
    if (this.state.expiresAt && Date.parse(this.state.expiresAt) <= this.now()) {
      this.disable();
      return false;
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Sliding-window limit per client; true when the request may proceed. */
  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  pending(): RemotePending {
    const name = (id?: string) => this.deps.bots().find((b) => b.id === id)?.name ?? id ?? 'A bot';
    const tasks = this.deps.tasks();
    return {
      // Security-held requests need the full review in AgentRoom; they're listed but not answerable here.
      approvals: this.deps.gate
        .pendingRequests()
        .filter((p) => !p.held)
        .map((p) => ({ requestId: p.requestId, botName: name(p.botId), tool: p.tool, summary: p.summary, reason: this.deps.reasonOf?.(p.requestId) ?? 'Needs approval', ts: Date.now() })),
      questions: this.deps.notifications
        .list()
        .filter((n) => n.kind === NotificationKind.Question && n.answer === undefined)
        .map((n) => ({ id: n.id, botName: name(n.botId), question: n.body, options: n.options ?? [], ts: Date.parse(String(n.ts)) || 0 })),
      plans: this.deps.goals
        .list()
        .filter((g) => g.status === GoalStatus.AwaitingApproval)
        .map((g) => ({ goalId: g.id, title: g.title, tasks: tasks.filter((t) => t.goalId === g.id).length })),
    };
  }

  decide(requestId: string, allow: boolean) {
    if (!this.deps.gate.pendingRequests().some((p) => p.requestId === requestId && !p.held)) throw new Error('That request is no longer waiting.');
    this.deps.gate.resolve(requestId, allow, false, ACTOR);
  }

  answer(notificationId: string, answer: string) {
    const text = answer.trim().slice(0, 2000);
    if (!text) throw new Error('Type an answer.');
    const n = this.deps.notifications.list().find((x) => x.id === notificationId);
    if (!n || n.kind !== NotificationKind.Question || n.answer !== undefined) throw new Error('That question is no longer waiting.');
    this.deps.notifications.answer(notificationId, text);
    this.deps.audit({ kind: AuditKind.Approval, actor: ACTOR, summary: `Answered: ${text.slice(0, 120)}`, ...(n.botId ? { botId: n.botId } : {}) });
  }

  approvePlan(goalId: string) {
    const g = this.deps.goals.approve(goalId);
    this.deps.audit({ kind: AuditKind.Goal, actor: ACTOR, summary: `Approved plan of ${g.id}`, goalId: g.id, decision: 'allowed' });
  }

  requestChanges(goalId: string, feedback: string) {
    const g = this.deps.goals.replan(goalId, feedback.slice(0, 4000));
    this.deps.audit({ kind: AuditKind.Goal, actor: ACTOR, summary: `Requested changes to ${g.id}`, goalId: g.id });
  }

  close() {
    this.clear();
  }
}
