import type { BotStatus, ClientMessageType, ServerMessageKind, StateType } from '../enums.js';
import type { Bot } from './bot.js';
import type { Config } from './config.js';
import type { StampedEvent, StreamDelta } from './events.js';
import type { BridgeActor, BridgeCmd, ConsoleLine, PreviewState } from './preview.js';
import type { Skill } from './skill.js';
import type { Goal, Task } from './task.js';
import type { Notification } from './notification.js';
import type { Settings } from './settings.js';
import type { SecurityFinding } from './security.js';
import type { McpSnapshot } from './mcp.js';
import type { AutomationSnapshot } from './automation.js';
import type { ContextStatus } from './context.js';
import type { AccountUsage, UsageSummary } from './usage.js';

export type StatusMap = Record<string, { status: BotStatus; activity?: string }>;

/** Full-state pushes after files change on disk. */
export type StateEvent =
  | { type: typeof StateType.Bots; bots: Bot[] }
  | { type: typeof StateType.Skills; skills: Skill[] }
  | { type: typeof StateType.Tasks; tasks: Task[] }
  | { type: typeof StateType.Goals; goals: Goal[] }
  | { type: typeof StateType.Settings; settings: Settings & { overrides?: string[] } }
  | { type: typeof StateType.Findings; findings: SecurityFinding[] }
  | { type: typeof StateType.Config; config: Config }
  | { type: typeof StateType.Mcp; mcp: McpSnapshot }
  | { type: typeof StateType.Automation; automation: AutomationSnapshot }
  | { type: typeof StateType.Context; context: ContextStatus };

export interface HelloMessage {
  kind: typeof ServerMessageKind.Hello;
  history: StampedEvent[];
  statuses: StatusMap;
  costUsd: number;
  usage: UsageSummary;
  account: AccountUsage | null;
  previews: Record<string, PreviewState>;
  consoles: Record<string, ConsoleLine[]>;
  notifications: Notification[];
}

/** Server → UI. */
export type ServerMessage =
  | HelloMessage
  | { kind: typeof ServerMessageKind.Event; event: StampedEvent }
  | { kind: typeof ServerMessageKind.State; event: StateEvent }
  | { kind: typeof ServerMessageKind.Stream; botId: string; delta: StreamDelta }
  | { kind: typeof ServerMessageKind.Preview; botId: string; state: PreviewState | null }
  | { kind: typeof ServerMessageKind.Console; botId: string; line: ConsoleLine }
  | { kind: typeof ServerMessageKind.BridgeCmd; botId: string; id: string; cmd: BridgeCmd; actor: BridgeActor }
  | { kind: typeof ServerMessageKind.Account; account: AccountUsage | null }
  /** New or updated notification (e.g. answered). */
  | { kind: typeof ServerMessageKind.Notification; notification: Notification };

/** UI → server. */
export type ClientMessage =
  /** `attachments` are ids returned by POST /api/uploads. */
  | { type: typeof ClientMessageType.Send; botId: string; text: string; attachments?: string[] }
  | { type: typeof ClientMessageType.Stop; botId?: string }
  | { type: typeof ClientMessageType.Permission; requestId: string; allow: boolean; always?: boolean }
  | { type: typeof ClientMessageType.Focus }
  | { type: typeof ClientMessageType.BrowserOpen; botId: string; url: string }
  | { type: typeof ClientMessageType.BrowserClose; botId: string }
  | { type: typeof ClientMessageType.BrowserControl; botId: string; on: boolean }
  | { type: typeof ClientMessageType.BridgeReady; botId: string; path: string; title: string }
  | { type: typeof ClientMessageType.BridgeConsole; botId: string; line: ConsoleLine }
  | { type: typeof ClientMessageType.BridgeResult; id: string; ok: boolean; result?: string; error?: string }
  | { type: typeof ClientMessageType.Answer; notificationId: string; answer: string }
  | { type: typeof ClientMessageType.NotificationsRead; ids: string[] }
  | { type: typeof ClientMessageType.Presence; active: boolean };
