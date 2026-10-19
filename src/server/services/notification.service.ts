import { randomUUID } from 'node:crypto';
import { NotificationKind } from '../../shared/enums.js';
import type { Notification } from '../../shared/types/index.js';
import { readJson, writeJson } from '../../core/fs/json.js';
import { INBOX_LIMIT } from '../config/constants.js';
import type { Hub } from '../realtime/hub.js';

export type NewNotification = Omit<Notification, 'id' | 'ts' | 'read' | 'answer'>;

type Waiter = { resolve: (answer: string) => void; reject: (err: Error) => void };

/**
 * The human's inbox: things bots and the workflow engine want them to see or answer.
 * Persisted to `.agentroom/runs/inbox.json`; broadcast live; questions can be awaited.
 */
export class NotificationService {
  private items: Notification[];
  private waiters = new Map<string, Waiter>();

  constructor(private readonly hub: Hub, private readonly file: string) {
    this.items = readJson<Notification[]>(file, []);
    // Questions from a previous server run can no longer be answered.
    for (const n of this.items) if (n.kind === NotificationKind.Question && n.answer === undefined) n.read = true;
    hub.useNotifications(() => this.items);
  }

  list(): Notification[] {
    return this.items;
  }

  create(input: NewNotification): Notification {
    const n: Notification = { ...input, id: randomUUID(), ts: Date.now(), read: false };
    this.items.push(n);
    if (this.items.length > INBOX_LIMIT) this.items.splice(0, this.items.length - INBOX_LIMIT);
    this.save();
    this.hub.notification(n, true);
    return n;
  }

  /** Create a question and wait for the human's answer (rejects if the signal aborts). */
  ask(input: Omit<NewNotification, 'kind'>, signal?: AbortSignal): Promise<string> {
    const n = this.create({ ...input, kind: NotificationKind.Question });
    return new Promise((resolve, reject) => {
      this.waiters.set(n.id, { resolve, reject });
      signal?.addEventListener(
        'abort',
        () => {
          this.waiters.delete(n.id);
          this.update(n.id, { read: true });
          reject(new Error('Aborted while waiting for an answer.'));
        },
        { once: true },
      );
    });
  }

  answer(id: string, answer: string): void {
    const n = this.items.find((x) => x.id === id);
    if (!n || n.answer !== undefined) return;
    this.update(id, { answer, read: true });
    this.waiters.get(id)?.resolve(answer);
    this.waiters.delete(id);
  }

  markRead(ids: string[]): void {
    for (const id of ids) {
      const n = this.items.find((x) => x.id === id);
      if (n && !n.read) this.update(id, { read: true });
    }
  }

  private update(id: string, patch: Partial<Notification>) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return;
    this.items[i] = { ...this.items[i], ...patch };
    this.save();
    this.hub.notification(this.items[i]);
  }

  private save() {
    writeJson(this.file, this.items);
  }
}
