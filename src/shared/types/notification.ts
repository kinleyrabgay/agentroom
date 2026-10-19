import type { NotificationKind } from '../enums.js';

/** Something that needs (or deserves) the human's attention. Shown in the inbox and as a desktop notification. */
export interface Notification {
  id: string;
  ts: number;
  kind: NotificationKind;
  title: string;
  body: string;
  botId?: string;
  goalId?: string;
  taskId?: string;
  read: boolean;
  /** For questions: suggested answers (the human may also type their own). */
  options?: string[];
  /** For questions: the human's answer once given. */
  answer?: string;
}

/** Personal alert preferences (stored per machine in `.agentroom/runs/alerts.json`, not committed). */
export interface AlertPrefs {
  /** Native OS notifications (macOS Notification Center / notify-send). */
  system: boolean;
  /** Play a sound with each alert. */
  sound: boolean;
  /** Sound name (macOS system sounds, e.g. Glass, Ping, Hero). */
  soundName: string;
  /** Speak a short line, e.g. "QA: tests passed". */
  voice: boolean;
  /** Only alert when no AgentRoom tab is focused. */
  onlyWhenAway: boolean;
}

/** What the alert channels can do on this machine (GET /api/alerts). */
export interface AlertCapabilities {
  platform: string;
  system: boolean;
  sound: boolean;
  voice: boolean;
  /** terminal-notifier is installed: clicking a notification opens AgentRoom. */
  clickToOpen: boolean;
  sounds: string[];
}
