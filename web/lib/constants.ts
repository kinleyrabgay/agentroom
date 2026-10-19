import { BotStatus } from "@shared"

type ValueOf<T> = T[keyof T]

/** Top-level workspace views. */
export const View = {
  Team: "team",
  Board: "board",
  Tasks: "tasks",
  Browser: "browser",
  Security: "security",
  Audit: "audit",
  Settings: "settings",
} as const
export type View = ValueOf<typeof View>

/** Tabs of the bot panel, in display order. */
export const BotTab = {
  Chat: "chat",
  Activity: "activity",
  Skills: "skills",
  Browser: "browser",
  Config: "config",
} as const
export type BotTab = ValueOf<typeof BotTab>

/** Tabs under a goal's header in the Tasks view, in display order (P2 adds Changes and Timeline). */
export const GoalTab = {
  Tasks: "tasks",
  Security: "security",
} as const
export type GoalTab = ValueOf<typeof GoalTab>

/** Base URL of the AgentRoom server. Empty in production (same origin); set by `npm run dev:web`. */
export const API_BASE = process.env.NEXT_PUBLIC_AGENTROOM_API ?? ""

export const TOKEN_STORAGE_KEY = "agentroom-token"
export const RECONNECT_DELAY_MS = 1500
export const MAX_CONSOLE_LINES = 300

/** HTML5 drag-and-drop payload types. */
export const DragType = {
  Skill: "application/x-agentroom-skill",
  Task: "application/x-agentroom-task",
  GithubItem: "application/x-agentroom-github-item",
} as const

/** Common dev-server addresses offered on the browser start page. */
export const DEV_SERVER_SUGGESTIONS = ["localhost:3000", "localhost:5173", "localhost:8080", "localhost:4200"] as const

/** Prefix the agent SDK adds to AgentRoom's own tools (e.g. `mcp__agentroom__browser_click`). */
export const HOST_TOOL_PREFIX = "mcp__agentroom__"

export const STATUS_META: Record<BotStatus, { label: string; dot: string }> = {
  [BotStatus.Idle]: { label: "Idle", dot: "bg-muted-foreground/50" },
  [BotStatus.Thinking]: { label: "Thinking", dot: "bg-sky-400" },
  [BotStatus.Working]: { label: "Working", dot: "bg-emerald-400" },
  [BotStatus.Waiting]: { label: "Needs you", dot: "bg-amber-400" },
  [BotStatus.Error]: { label: "Error", dot: "bg-destructive" },
}

export const isBusy = (s: BotStatus | undefined) => s === BotStatus.Thinking || s === BotStatus.Working || s === BotStatus.Waiting
