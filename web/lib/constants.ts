import { BotStatus } from "@shared"
import type { Tone } from "@/components/kit/tone"

type ValueOf<T> = T[keyof T]

/** Top-level workspace views. */
export const View = {
  Team: "team",
  /** Everything waiting on the human: approvals, questions, plan reviews, gates, sign-ins. */
  Inbox: "inbox",
  /** Goals and their tasks (was "Tasks"). */
  Work: "work",
  /** The repo map bots read: modules, cards and dependencies. */
  Context: "context",
  /** Schedules and triggers that run the team without the human. */
  Automation: "automation",
  /** The GitHub Project board (was "Board"). */
  Github: "github",
  Sentry: "sentry",
  /** Linear issues (shown once connected). */
  Linear: "linear",
  /** Jira issues (shown once connected). */
  Jira: "jira",
  /** Pull requests the Reviewer drafted a review for. */
  Reviews: "reviews",
  Browser: "browser",
  Security: "security",
  Audit: "audit",
  /** Results, spend and failure reasons over time. */
  Insights: "insights",
  /** MCP servers; shown inside Settings → Integrations. */
  Connections: "connections",
  Settings: "settings",
} as const
export type View = ValueOf<typeof View>

/** Tabs of the bot panel, in display order. */
export const BotTab = {
  Chat: "chat",
  Activity: "activity",
  Skills: "skills",
  /** What the bot has learned about the repo (bots/<dir>/memory.md). */
  Memory: "memory",
  Browser: "browser",
  Config: "config",
} as const
export type BotTab = ValueOf<typeof BotTab>

/** Tabs under a goal's header in the Tasks view, in display order (P2 adds Changes and Timeline). */
export const GoalTab = {
  Tasks: "tasks",
  /** The goal's diff with inline review comments. */
  Changes: "changes",
  Security: "security",
  /** Replay of what each bot did. */
  Timeline: "timeline",
  /** Proof of work: recording, before/after, quality checks. */
  Proof: "proof",
  /** Team room comments on the goal and its plan. */
  Discussion: "discussion",
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

/** Bot status: label, tone (badges, dots) and the dot class for places that draw their own. */
export const STATUS_META: Record<BotStatus, { label: string; tone: Tone; dot: string }> = {
  [BotStatus.Idle]: { label: "Idle", tone: "neutral", dot: "bg-muted-foreground/50" },
  [BotStatus.Thinking]: { label: "Thinking", tone: "info", dot: "bg-info" },
  [BotStatus.Working]: { label: "Working", tone: "brand", dot: "bg-brand" },
  [BotStatus.Waiting]: { label: "Needs you", tone: "warning", dot: "bg-warning" },
  [BotStatus.Error]: { label: "Error", tone: "danger", dot: "bg-danger" },
}

export const isBusy = (s: BotStatus | undefined) => s === BotStatus.Thinking || s === BotStatus.Working || s === BotStatus.Waiting
