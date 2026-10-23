import type { QueueHoldReason, SteerStatus } from '../enums.js';

/** A message you sent while the bot was busy; it goes out when the current run ends cleanly. */
export interface QueuedMessage {
  id: string;
  text: string;
  /** Upload ids (POST /api/uploads). */
  attachments?: string[];
  createdAt: number;
}

/** Why the queue waits for you instead of sending the next message. */
export interface QueueHold {
  reason: QueueHoldReason;
  at: number;
  /** Usage limit: when it resets (epoch ms), if the provider said. */
  until?: number;
}

/** A message written into the running turn. */
export interface Steer {
  id: string;
  text: string;
  status: SteerStatus;
}

/** One bot's queue, as the UI shows it above the composer. */
export interface BotQueue {
  items: QueuedMessage[];
  hold: QueueHold | null;
  /** Steers of the current run that haven't been taken yet. */
  steers: Steer[];
  /** Continue on its own when the usage limit resets. */
  resumeAtReset: boolean;
}

export type QueueMap = Record<string, BotQueue>;
