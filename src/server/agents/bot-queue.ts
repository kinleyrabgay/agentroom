import { randomUUID } from 'node:crypto';
import { QueueHoldReason, SteerStatus } from '../../shared/enums.js';
import type { BotQueue, QueueHold, QueueMap, QueuedMessage, Steer } from '../../shared/types/index.js';
import { readJson, writeJson } from '../../core/fs/json.js';

/** Per bot: at most this many queued messages, and this much text in one. */
export const QUEUE_LIMITS = { items: 50, textChars: 128 * 1024 };

interface Stored {
  items: QueuedMessage[];
  hold: QueueHold | null;
  resumeAtReset: boolean;
}

const empty = (): BotQueue => ({ items: [], hold: null, steers: [], resumeAtReset: false });

/**
 * Messages you send while a bot is busy, in order, kept in `runs/queue.json` so a restart doesn't lose
 * them. Nothing here decides when to send: the Team drains the queue after a clean run and leaves it
 * held, with the reason, after a failed, stopped or rate-limited one.
 */
export class BotQueues {
  private queues = new Map<string, BotQueue>();
  private listeners: ((botId: string, queue: BotQueue) => void)[] = [];

  constructor(private readonly file: string) {
    const saved = readJson<Record<string, Stored>>(file, {});
    for (const [botId, q] of Object.entries(saved)) {
      if (!q || !Array.isArray(q.items)) continue;
      // Messages still queued from before a restart wait for you instead of going out on their own.
      const hold = q.hold ?? (q.items.length ? { reason: QueueHoldReason.Restart, at: Date.now() } : null);
      this.queues.set(botId, { items: q.items, hold, steers: [], resumeAtReset: !!q.resumeAtReset });
    }
  }

  onChange(fn: (botId: string, queue: BotQueue) => void) {
    this.listeners.push(fn);
  }

  get(botId: string): BotQueue {
    return this.queues.get(botId) ?? empty();
  }

  /** Bots with anything to show. */
  all(): QueueMap {
    const out: QueueMap = {};
    for (const [id, q] of this.queues) if (q.items.length || q.hold || q.steers.length || q.resumeAtReset) out[id] = q;
    return out;
  }

  add(botId: string, text: string, attachments?: string[], atHead = false): QueuedMessage {
    const q = this.mutable(botId);
    if (q.items.length >= QUEUE_LIMITS.items) throw new Error(`The queue holds at most ${QUEUE_LIMITS.items} messages.`);
    if (text.length > QUEUE_LIMITS.textChars) throw new Error('That message is too long to queue.');
    const item: QueuedMessage = { id: randomUUID(), text, ...(attachments?.length ? { attachments } : {}), createdAt: Date.now() };
    if (atHead) q.items.unshift(item);
    else q.items.push(item);
    this.changed(botId);
    return item;
  }

  /** Take the next message out (it's sent at most once). */
  shift(botId: string): QueuedMessage | undefined {
    const q = this.queues.get(botId);
    const item = q?.items.shift();
    if (item) this.changed(botId);
    return item;
  }

  remove(botId: string, id: string): QueuedMessage | undefined {
    const q = this.queues.get(botId);
    const i = q?.items.findIndex((m) => m.id === id) ?? -1;
    if (!q || i < 0) return undefined;
    const [item] = q.items.splice(i, 1);
    this.changed(botId);
    return item;
  }

  edit(botId: string, id: string, text: string) {
    const item = this.queues.get(botId)?.items.find((m) => m.id === id);
    if (!item || !text.trim()) return;
    if (text.length > QUEUE_LIMITS.textChars) throw new Error('That message is too long to queue.');
    item.text = text;
    this.changed(botId);
  }

  move(botId: string, id: string, index: number) {
    const q = this.queues.get(botId);
    const from = q?.items.findIndex((m) => m.id === id) ?? -1;
    if (!q || from < 0) return;
    const [item] = q.items.splice(from, 1);
    q.items.splice(Math.max(0, Math.min(index, q.items.length)), 0, item!);
    this.changed(botId);
  }

  hold(botId: string, reason: QueueHoldReason, until?: number) {
    const q = this.mutable(botId);
    // A usage limit outranks the failure it caused; otherwise the newest reason wins.
    if (q.hold?.reason === QueueHoldReason.Limited && reason !== QueueHoldReason.Limited) return;
    q.hold = { reason, at: Date.now(), ...(until ? { until } : {}) };
    this.changed(botId);
  }

  release(botId: string) {
    const q = this.queues.get(botId);
    if (!q?.hold) return;
    q.hold = null;
    this.changed(botId);
  }

  setResumeAtReset(botId: string, on: boolean) {
    const q = this.mutable(botId);
    if (q.resumeAtReset === on) return;
    q.resumeAtReset = on;
    this.changed(botId);
  }

  // ---------- steers (live only, never saved) ----------

  steer(botId: string, steer: Steer) {
    this.mutable(botId).steers.push(steer);
    this.changed(botId);
  }

  /** Update a steer; delivered and failed ones leave the list. Returns the steer. */
  steerStatus(botId: string, id: string, status: SteerStatus): Steer | undefined {
    const q = this.queues.get(botId);
    const s = q?.steers.find((x) => x.id === id);
    if (!q || !s) return undefined;
    if (status === SteerStatus.Pending) s.status = status;
    else q.steers = q.steers.filter((x) => x.id !== id);
    this.changed(botId);
    return { ...s, status };
  }

  private mutable(botId: string): BotQueue {
    let q = this.queues.get(botId);
    if (!q) this.queues.set(botId, (q = empty()));
    return q;
  }

  private changed(botId: string) {
    const q = this.get(botId);
    this.save();
    for (const fn of this.listeners) fn(botId, q);
  }

  private save() {
    const out: Record<string, Stored> = {};
    for (const [id, q] of this.queues) {
      if (q.items.length || q.hold || q.resumeAtReset) out[id] = { items: q.items, hold: q.hold, resumeAtReset: q.resumeAtReset };
    }
    writeJson(this.file, out);
  }
}
