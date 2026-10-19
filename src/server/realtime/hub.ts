import fs from 'node:fs';
import path from 'node:path';
import { AgentEventType, ServerMessageKind, type WorkPhase } from '../../shared/enums.js';
import { applyRateLimit, applyUsage, emptyUsage } from '../../shared/usage/reducer.js';
import type {
  AccountUsage,
  AgentEvent,
  ConsoleLine,
  Notification,
  PreviewState,
  ServerMessage,
  StampedEvent,
  StateEvent,
  StatusMap,
  StreamDelta,
  UsageSummary,
} from '../../shared/types/index.js';
import { CONSOLE_LIMIT, CONSOLE_TAIL, HISTORY_LIMIT } from '../config/constants.js';

/** A connected UI. */
export interface Client {
  send(data: string): void;
}

/** Listeners get the stamped event (with goalId when it happened inside a goal run). */
export type EventListener = (event: StampedEvent) => void;

/** What a bot is currently working on; events from that bot are attributed to it. */
export interface RunContext {
  goalId?: string;
  taskId?: string;
  phase?: WorkPhase;
}

/**
 * The realtime hub: fans events out to every connected UI, keeps the state a newly
 * connected UI needs (history, statuses, previews, usage), and logs events to JSONL.
 */
export class Hub {
  private clients = new Set<Client>();
  /** Clients whose tab is visible and focused. */
  private active = new Set<Client>();
  private notificationListeners = new Set<(n: Notification) => void>();
  private listeners = new Set<EventListener>();
  /** The UI tab that executes bridge commands (most recently focused). Other tabs only watch. */
  private primary: Client | null = null;
  private history: StampedEvent[] = [];
  private seq = 0;
  private readonly logFile: string;
  private consoles: Record<string, ConsoleLine[]> = {};
  private notifications: () => Notification[] = () => [];
  /** Current run context per bot (set by the Team for the duration of a run). */
  private contexts = new Map<string, RunContext>();

  readonly statuses: StatusMap = {};
  readonly previews: Record<string, PreviewState> = {};
  costUsd = 0;
  usage: UsageSummary = emptyUsage();
  account: AccountUsage | null = null;

  constructor(runsDir: string) {
    fs.mkdirSync(runsDir, { recursive: true });
    this.logFile = path.join(runsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  }

  // ---------- clients ----------

  add(client: Client) {
    this.clients.add(client);
    this.primary ??= client;
    this.sendTo(client, {
      kind: ServerMessageKind.Hello,
      history: this.history,
      statuses: this.statuses,
      costUsd: this.costUsd,
      usage: this.usage,
      account: this.account,
      previews: this.previews,
      consoles: this.consoles,
      notifications: this.notifications(),
    });
  }

  remove(client: Client) {
    this.clients.delete(client);
    this.active.delete(client);
    if (this.primary === client) this.primary = [...this.clients].at(-1) ?? null;
  }

  focus(client: Client) {
    if (this.clients.has(client)) this.primary = client;
  }

  /** A UI tab reports whether it is visible and focused. */
  setPresence(client: Client, active: boolean) {
    if (!this.clients.has(client)) return;
    if (active) {
      this.active.add(client);
      this.primary = client;
    } else this.active.delete(client);
  }

  /** True while the human is looking at an AgentRoom tab. */
  get isActive() {
    return this.active.size > 0;
  }

  get hasUi() {
    return this.clients.size > 0;
  }

  /** Send to the primary UI only. Returns false when no UI is open. */
  toPrimary(msg: ServerMessage): boolean {
    if (!this.primary) return false;
    return this.sendTo(this.primary, msg);
  }

  // ---------- events ----------

  /**
   * Broadcast, record and log an event. It is stamped with a goalId from `ctx`, or else from the
   * run context of the bot it concerns (so permission requests, tool calls and delegations made
   * during a goal run are attributed to that goal without every emitter knowing about goals).
   */
  emit(event: AgentEvent, ctx?: RunContext) {
    const goalId = ctx?.goalId ?? this.contextOf(subjectBot(event))?.goalId;
    const stamped = { ...event, ts: Date.now(), seq: ++this.seq, ...(goalId ? { goalId } : {}) } as StampedEvent;
    this.reduce(event);
    this.history.push(stamped);
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    fs.appendFile(this.logFile, JSON.stringify(stamped) + '\n', () => {});
    this.broadcast({ kind: ServerMessageKind.Event, event: stamped });
    for (const fn of this.listeners) fn(stamped);
  }

  /** Attribute a bot's events to a goal/task/phase until cleared (pass null). */
  setRunContext(botId: string, ctx: RunContext | null) {
    if (ctx && (ctx.goalId || ctx.taskId || ctx.phase)) this.contexts.set(botId, ctx);
    else this.contexts.delete(botId);
  }

  contextOf(botId: string | undefined): RunContext | undefined {
    return botId ? this.contexts.get(botId) : undefined;
  }

  onEvent(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Streaming deltas are broadcast only — never stored or logged. */
  stream(botId: string, delta: StreamDelta) {
    this.broadcast({ kind: ServerMessageKind.Stream, botId, delta });
  }

  state(event: StateEvent) {
    this.broadcast({ kind: ServerMessageKind.State, event });
  }

  /** Where the hello message gets the inbox from. */
  useNotifications(source: () => Notification[]) {
    this.notifications = source;
  }

  /** Broadcast a new or updated notification; listeners hear only new ones. */
  notification(notification: Notification, created = false) {
    this.broadcast({ kind: ServerMessageKind.Notification, notification });
    if (created) for (const fn of this.notificationListeners) fn(notification);
  }

  onNotification(fn: (n: Notification) => void): () => void {
    this.notificationListeners.add(fn);
    return () => this.notificationListeners.delete(fn);
  }

  setAccount(account: AccountUsage | null) {
    this.account = account;
    this.broadcast({ kind: ServerMessageKind.Account, account });
  }

  // ---------- previews ----------

  preview(botId: string, state: PreviewState | null) {
    if (state) this.previews[botId] = state;
    else {
      delete this.previews[botId];
      delete this.consoles[botId];
    }
    this.broadcast({ kind: ServerMessageKind.Preview, botId, state });
  }

  console(botId: string, line: ConsoleLine) {
    const lines = (this.consoles[botId] ??= []);
    lines.push(line);
    if (lines.length > CONSOLE_LIMIT) lines.splice(0, lines.length - CONSOLE_LIMIT);
    this.broadcast({ kind: ServerMessageKind.Console, botId, line });
  }

  recentConsole(botId: string, n = CONSOLE_TAIL): ConsoleLine[] {
    return (this.consoles[botId] ?? []).slice(-n);
  }

  // ---------- internals ----------

  private reduce(event: AgentEvent) {
    switch (event.type) {
      case AgentEventType.BotStatus:
        this.statuses[event.botId] = { status: event.status, activity: event.activity };
        break;
      case AgentEventType.RunDone:
        this.costUsd += event.costUsd;
        break;
      case AgentEventType.Usage:
        this.usage = applyUsage(this.usage, event);
        break;
      case AgentEventType.RateLimit:
        this.usage = applyRateLimit(this.usage, event);
        break;
    }
  }

  private sendTo(client: Client, msg: ServerMessage): boolean {
    try {
      client.send(JSON.stringify(msg));
      return true;
    } catch {
      this.remove(client);
      return false;
    }
  }

  private broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      try {
        c.send(data);
      } catch {
        this.remove(c);
      }
    }
  }
}

/** The bot an event is about (delegations: the delegating bot). */
function subjectBot(event: AgentEvent): string | undefined {
  if (event.type === AgentEventType.Delegation) return event.from;
  return 'botId' in event ? event.botId : undefined;
}
