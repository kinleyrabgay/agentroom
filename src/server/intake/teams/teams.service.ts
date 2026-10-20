import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ActorType, AuditKind, GoalStatus } from '../../../shared/enums.js';
import type { Goal, TeamsConfig, TeamsStatus, TeamsUnknownSender, TeamsUser } from '../../../shared/types/index.js';
import { readJson, writeJson } from '../../../core/fs/json.js';
import type { NewAuditEntry } from '../../services/audit.service.js';
import type { SecretsStore } from '../../services/secrets.store.js';
import type { GoalChange } from '../goal-watch.js';
import { label, type IntakeService } from '../intake.service.js';
import { outgoingReply, workflowMessage, type CardSpec } from './cards.js';

export const TEAMS_INBOUND_PATH = '/teams/inbound';
const BODY_MAX = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const SEEN_MAX = 500;
const UNKNOWN_MAX = 20;
/** At most one update per goal in this window; the latest state wins. */
const THROTTLE_MS = 15_000;

const UserSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  identity: z.string().max(300).optional(),
  role: z.enum(['member', 'approver']).default('member'),
});
const ConfigSchema = z.object({
  enabled: z.boolean().default(false),
  users: z.array(UserSchema).default([]),
  stopAfterPlan: z.boolean().default(true),
  announceAll: z.boolean().default(false),
  publicUrl: z
    .string()
    .default('')
    .refine((v) => v === '' || /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(v), 'must be an https URL'),
});
export const DEFAULT_TEAMS_CONFIG: TeamsConfig = ConfigSchema.parse({});

interface TeamsState {
  /** Goals started from Teams: who asked. */
  goals: Record<string, { by: string; at: string }>;
  unknown: TeamsUnknownSender[];
  /** Activity ids already handled (replay protection). */
  seen: string[];
  lastInboundAt?: string;
}

/** The parts of a Bot Framework activity an outgoing webhook sends that we use. */
interface Activity {
  type?: string;
  id?: string;
  text?: string;
  from?: { id?: string; name?: string; aadObjectId?: string };
}

export interface TeamsDeps {
  /** `.agentroom/integrations/teams.json` (committed). */
  configFile: string;
  /** `.agentroom/runs/teams.json` (local). */
  stateFile: string;
  secrets: SecretsStore;
  intake: IntakeService;
  goals: { list(): Goal[]; approve(id: string): Goal };
  /** The phone-approvals tunnel URL while it's on. */
  tunnelUrl: () => string | undefined;
  audit: (e: NewAuditEntry) => void;
  post?: (url: string, body: unknown) => Promise<void>;
  now?: () => number;
}

export type InboundResult = { status: number; body: Record<string, unknown> };

/**
 * Microsoft Teams without an Azure bot registration:
 * - in: a channel's **outgoing webhook** (@mention → signed POST to this machine through a tunnel),
 *   verified with its HMAC key and an allow-list of people;
 * - out: a **Workflows webhook** (Adaptive Cards) for plans, progress and PR links.
 * Approvals are typed commands from allow-listed approvers, so every decision has a verified name.
 */
export class TeamsService {
  private state: TeamsState;
  private hits = new Map<string, number[]>();
  private lastPost = new Map<string, number>();
  private queued = new Map<string, { timer: NodeJS.Timeout; card: CardSpec }>();

  constructor(private readonly deps: TeamsDeps) {
    this.state = { goals: {}, unknown: [], seen: [], ...readJson<Partial<TeamsState>>(deps.stateFile, {}) };
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  config(): TeamsConfig {
    if (!fs.existsSync(this.deps.configFile)) return { ...DEFAULT_TEAMS_CONFIG };
    const parsed = ConfigSchema.safeParse(readJson<unknown>(this.deps.configFile, {}));
    return parsed.success ? parsed.data : { ...DEFAULT_TEAMS_CONFIG };
  }

  updateConfig(patch: Partial<TeamsConfig>, by: string): TeamsStatus {
    const parsed = ConfigSchema.safeParse({ ...this.config(), ...patch });
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    // Duplicate people would make roles ambiguous.
    const ids = new Set<string>();
    for (const u of parsed.data.users) {
      if (ids.has(u.id)) throw new Error(`${u.name} is on the list twice.`);
      ids.add(u.id);
    }
    writeJson(this.deps.configFile, parsed.data);
    this.audit(by, 'Teams settings changed', { enabled: parsed.data.enabled, users: parsed.data.users.map((u) => `${u.name} (${u.role})`) });
    if (patch.users) {
      // Someone just added is no longer "unknown".
      this.state.unknown = this.state.unknown.filter((u) => !ids.has(u.id));
      this.save();
    }
    return this.status();
  }

  /** Store (or with '' clear) the outgoing webhook's security token and/or the workflow URL. Local only. */
  setSecrets(input: { outgoingSecret?: string; workflowUrl?: string }, by: string): TeamsStatus {
    if (input.outgoingSecret !== undefined) {
      const v = input.outgoingSecret.trim();
      if (v && !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) throw new Error('The security token is the base64 text Teams showed when you created the outgoing webhook.');
      this.deps.secrets.setCredential('teamsOutgoingSecret', v);
    }
    if (input.workflowUrl !== undefined) this.deps.secrets.update({ teamsWebhook: input.workflowUrl.trim() });
    this.audit(by, 'Teams credentials updated');
    return this.status();
  }

  status(): TeamsStatus {
    const config = this.config();
    const secrets = this.deps.secrets.read();
    const base = config.publicUrl || this.deps.tunnelUrl() || '';
    return {
      config,
      hasSecret: !!secrets.teamsOutgoingSecret,
      hasWorkflow: !!secrets.teamsWebhook,
      callbackUrl: base ? `${base.replace(/\/+$/, '')}${TEAMS_INBOUND_PATH}` : null,
      publicUrlSource: config.publicUrl ? 'custom' : this.deps.tunnelUrl() ? 'phone-tunnel' : 'none',
      unknown: this.state.unknown,
      ...(this.state.lastInboundAt ? { lastInboundAt: this.state.lastInboundAt } : {}),
    };
  }

  /** Post a test card to the workflow (only when the human clicks Test). */
  async test(by: string): Promise<void> {
    const url = this.deps.secrets.read().teamsWebhook;
    if (!url) throw new Error('Paste the Workflow webhook URL first.');
    await this.send(url, { title: 'AgentRoom is connected', text: 'Plans, progress and pull requests for goals started from Teams will show up here.', tone: 'good' });
    this.audit(by, 'Teams test card sent');
  }

  // ---------- inbound ----------

  /** Rate limit per client address. */
  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    const ok = recent.length < RATE_MAX;
    if (ok) recent.push(now);
    this.hits.set(key, recent);
    return ok;
  }

  /** Handle one outgoing-webhook POST. `raw` is the exact body bytes the signature covers. */
  inbound(raw: Buffer, authorization: string | undefined): InboundResult {
    const config = this.config();
    const secret = this.deps.secrets.read().teamsOutgoingSecret;
    if (!config.enabled || !secret) return { status: 404, body: { error: 'not found' } };
    if (raw.length > BODY_MAX) return { status: 413, body: { error: 'too large' } };
    if (!verifySignature(raw, authorization, secret)) return { status: 401, body: { error: 'bad signature' } };

    let activity: Activity;
    try {
      activity = JSON.parse(raw.toString('utf8')) as Activity;
    } catch {
      return { status: 400, body: { error: 'bad json' } };
    }
    if (activity.id) {
      if (this.state.seen.includes(activity.id)) return { status: 200, body: outgoingReply({ title: 'Already handled' }) };
      this.state.seen = [...this.state.seen, activity.id].slice(-SEEN_MAX);
    }
    this.state.lastInboundAt = new Date(this.now()).toISOString();

    const senderId = activity.from?.aadObjectId ?? activity.from?.id ?? '';
    const senderName = activity.from?.name ?? 'Someone';
    const text = cleanTeamsText(activity.text ?? '');
    const user = config.users.find((u) => u.id === senderId);
    if (!user) {
      this.rememberUnknown({ id: senderId, name: senderName, at: this.state.lastInboundAt, text: text.slice(0, 200) });
      this.deps.audit({ kind: AuditKind.Intake, actor: { type: ActorType.External, name: `Teams: ${senderName}` }, summary: 'Ignored a Teams message from someone not on the allow-list', decision: 'denied', detail: { id: senderId } });
      this.save();
      return {
        status: 200,
        body: outgoingReply({ title: 'You’re not on the list yet', text: `Ask the AgentRoom owner to add you in Settings → Integrations → Teams. Your id: ${senderId || 'unknown'}`, tone: 'warning' }),
      };
    }

    const result = this.deps.intake.handle({ channel: 'teams', user: toIntakeUser(user), text });
    if (result.goalId) this.track(result.goalId, user);
    if (result.later) {
      void result.later
        .then((r) => {
          if (r.goalId) this.track(r.goalId, user);
          return this.notify(r.reply);
        })
        .catch((err: Error) => this.notify({ title: 'That didn’t work', text: err.message, tone: 'attention' }));
    }
    this.save();
    return { status: 200, body: outgoingReply(result.reply) };
  }

  private rememberUnknown(u: TeamsUnknownSender) {
    this.state.unknown = [u, ...this.state.unknown.filter((x) => x.id !== u.id)].slice(0, UNKNOWN_MAX);
  }

  private track(goalId: string, user: TeamsUser) {
    this.state.goals[goalId] = { by: user.name, at: new Date(this.now()).toISOString() };
  }

  // ---------- outbound ----------

  /** Goal progress → Teams, for goals started there (or all, when announceAll). */
  onGoalChange(c: GoalChange) {
    const config = this.config();
    if (!config.enabled) return;
    const tracked = this.state.goals[c.goal.id];
    if (!tracked && !config.announceAll) return;
    const g = c.goal;

    if (c.kind === 'status' && g.status === GoalStatus.AwaitingApproval && tracked && !config.stopAfterPlan) {
      this.deps.goals.approve(g.id);
      this.deps.audit({ kind: AuditKind.Goal, actor: { type: ActorType.Policy, name: 'Teams: build without waiting' }, summary: `Approved plan of ${g.id} automatically`, goalId: g.id, decision: 'allowed' });
      return;
    }
    const card = goalCard(c, tracked?.by);
    if (card) this.queue(g.id, card);
  }

  private queue(goalId: string, card: CardSpec) {
    const last = this.lastPost.get(goalId) ?? 0;
    const wait = last + THROTTLE_MS - this.now();
    const pending = this.queued.get(goalId);
    if (wait <= 0 && !pending) {
      this.lastPost.set(goalId, this.now());
      void this.notify(card);
      return;
    }
    if (pending) {
      pending.card = card;
      return;
    }
    const timer = setTimeout(() => {
      const q = this.queued.get(goalId);
      this.queued.delete(goalId);
      if (!q) return;
      this.lastPost.set(goalId, this.now());
      void this.notify(q.card);
    }, Math.max(wait, 0));
    timer.unref?.();
    this.queued.set(goalId, { timer, card });
  }

  /** Post a card to the workflow webhook; failures are swallowed (Teams is best-effort). */
  async notify(card: CardSpec): Promise<boolean> {
    const url = this.deps.secrets.read().teamsWebhook;
    if (!url) return false;
    try {
      await this.send(url, card);
      return true;
    } catch {
      return false;
    }
  }

  private async send(url: string, card: CardSpec) {
    await (this.deps.post ?? postJson)(url, workflowMessage(card));
  }

  private audit(by: string, summary: string, detail?: Record<string, unknown>) {
    this.deps.audit({ kind: AuditKind.Settings, actor: { type: ActorType.Human, name: by }, summary, ...(detail ? { detail } : {}) });
  }

  private save() {
    fs.mkdirSync(path.dirname(this.deps.stateFile), { recursive: true });
    writeJson(this.deps.stateFile, this.state);
  }

  close() {
    for (const q of this.queued.values()) clearTimeout(q.timer);
    this.queued.clear();
  }
}

const toIntakeUser = (u: TeamsUser) => ({ externalId: u.id, name: u.name, ...(u.identity ? { identity: u.identity } : {}), role: u.role });

/** Teams signs the body with HMAC-SHA256 using the base64-decoded security token: `Authorization: HMAC <base64>`. */
export function verifySignature(raw: Buffer, authorization: string | undefined, secretB64: string): boolean {
  const m = /^HMAC\s+(\S+)$/i.exec(authorization?.trim() ?? '');
  if (!m) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secretB64, 'base64');
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(raw).digest();
  const given = Buffer.from(m[1]!, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** Message text without the @mention, HTML markup and entities. */
export function cleanTeamsText(html: string): string {
  return html
    .replace(/<at>[\s\S]*?<\/at>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k]!;
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
      return all;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The card for a goal change worth telling the channel about, or null. */
export function goalCard(c: GoalChange, by?: string): CardSpec | null {
  const g = c.goal;
  const who = by ? `Asked by ${by}` : undefined;
  if (c.kind === 'pr') return { title: `${g.id}: pull request ready`, subtitle: g.title, links: [{ title: 'Open the PR', url: g.pr!.url }], tone: 'good' };
  if (c.kind === 'created') return null;
  switch (g.status) {
    case GoalStatus.AwaitingApproval:
      return {
        title: `${g.id}: plan ready for review`,
        subtitle: [g.title, who].filter(Boolean).join(' · '),
        text: firstLines(g.plan, 12) || 'The plan is ready.',
        hints: [`approve ${g.id}`, `changes ${g.id} <what to change>`],
        tone: 'accent',
      };
    case GoalStatus.Building:
    case GoalStatus.Securing:
    case GoalStatus.Testing:
      return { title: `${g.id}: ${label(g.status).toLowerCase()}`, subtitle: g.title };
    case GoalStatus.Paused:
      return { title: `${g.id} paused`, subtitle: g.title, text: g.reason ?? 'It needs someone in AgentRoom.', tone: 'warning', hints: ['pending'] };
    case GoalStatus.Done:
      return {
        title: `${g.id} done`,
        subtitle: g.title,
        text: firstLines(g.summary, 10) || undefined,
        ...(g.pr ? { links: [{ title: 'Open the PR', url: g.pr.url }] } : {}),
        tone: 'good',
      };
    case GoalStatus.Failed:
      return { title: `${g.id} failed`, subtitle: g.title, text: g.reason ?? undefined, tone: 'attention' };
    default:
      return null;
  }
}

function firstLines(md: string, n: number): string {
  return md.trim().split('\n').filter((l) => l.trim()).slice(0, n).join('\n');
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Teams answered ${res.status}`);
}
