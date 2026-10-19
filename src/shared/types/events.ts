import type { AgentEventType, BotStatus, StreamDeltaType } from '../enums.js';
import type { RateLimit, UsageReport } from './usage.js';
import type { SecurityFinding } from './security.js';

/** Things that happen during runs. Broadcast to the UI and appended to `.agentroom/runs/*.jsonl`. */
export type AgentEvent =
  | { type: typeof AgentEventType.BotStatus; botId: string; status: BotStatus; activity?: string }
  | { type: typeof AgentEventType.UserMessage; botId: string; text: string; from: string }
  | { type: typeof AgentEventType.Message; botId: string; text: string }
  | { type: typeof AgentEventType.ToolCall; botId: string; toolUseId: string; name: string; summary: string; input: unknown }
  | { type: typeof AgentEventType.ToolResult; botId: string; toolUseId: string; ok: boolean; output: string }
  | {
      type: typeof AgentEventType.PermissionRequest;
      botId: string;
      requestId: string;
      tool: string;
      summary: string;
      input: unknown;
      reason: string;
      /** Security findings that forced this approval (commit/push/PR gate). */
      findings?: SecurityFinding[];
    }
  | { type: typeof AgentEventType.PermissionResolved; botId: string; requestId: string; allowed: boolean }
  | { type: typeof AgentEventType.Delegation; from: string; to: string; instruction: string }
  | { type: typeof AgentEventType.RunDone; botId: string; ok: boolean; costUsd: number; durationMs: number; turns: number; result: string }
  | ({ type: typeof AgentEventType.Usage } & UsageReport)
  | ({ type: typeof AgentEventType.RateLimit } & RateLimit)
  | { type: typeof AgentEventType.Error; botId?: string; message: string };

/** Server stamp: arrival order, time, and the goal the event belongs to (if any). */
export type Stamped<E> = E & { ts: number; seq: number; goalId?: string };
export type StampedEvent = Stamped<AgentEvent>;

/** Extract one event variant by its type. */
export type EventOf<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;

/** Live, unlogged progress of the reply being generated. Final content still arrives as AgentEvents. */
export type StreamDelta =
  | { type: typeof StreamDeltaType.TextStart }
  | { type: typeof StreamDeltaType.Text; text: string }
  | { type: typeof StreamDeltaType.Thinking }
  | { type: typeof StreamDeltaType.ToolStart; toolUseId: string; name: string };
