"use client"

import { create } from "zustand"
import {
  emptyUsage,
  type AccountUsage,
  type Bot,
  type ConsoleLine,
  type Goal,
  type Notification,
  type PickedElement,
  type PreviewState,
  type ProjectInfo,
  type ProviderModels,
  type SecurityFinding,
  type McpSnapshot,
  type AutomationSnapshot,
  type Settings,
  type Skill,
  type StampedEvent,
  type StatusMap,
  type Task,
  type UsageSummary,
} from "@shared"
import { BotTab, GoalTab, View } from "@/lib/constants"
import type { LiveReply } from "./live-reply"

export interface AppState {
  // session
  token: string
  /** True once the token was read on the client (it may be empty). */
  tokenChecked: boolean
  connected: boolean
  // project data (server-owned)
  info: ProjectInfo | null
  bots: Bot[]
  skills: Skill[]
  tasks: Task[]
  goals: Goal[]
  /** Inbox, newest last (server order). */
  notifications: Notification[]
  events: StampedEvent[]
  statuses: StatusMap
  usage: UsageSummary
  account: AccountUsage | null
  previews: Record<string, PreviewState>
  consoles: Record<string, ConsoleLine[]>
  live: Record<string, LiveReply>
  /** Security findings across goals (StateType.Findings push, or the initial fetch). */
  findings: SecurityFinding[]
  /** External MCP servers and their status (StateType.Mcp push); null until the server sends it. */
  mcp: McpSnapshot | null
  /** Schedules, triggers and run history (StateType.Automation push). */
  automation: AutomationSnapshot | null
  /** Team-wide settings (`.agentroom/settings.json`); null until loaded. */
  settings: Settings | null
  /** Models the current provider offers (GET /api/models), fetched once. */
  models: ProviderModels | null
  modelsStatus: LoadStatus
  // UI-only state
  /** Library skill currently being dragged from the sidebar (drives drop-target styling). */
  draggingSkill: string | null
  /** Last skill added to a bot, so its chip can animate in. */
  recentSkill: { botId: string; skill: string; at: number } | null
  picking: Record<string, boolean>
  attachments: Record<string, PickedElement[]>
  selectedBot: string | null
  botTab: BotTab
  browserBot: string | null
  view: View
  /** Goal shown in the Tasks view; `ALL_TASKS` shows tasks without a goal; null = newest goal. */
  selectedGoalId: string | null
  /** Task open in the detail sheet. */
  selectedTaskId: string | null
  /** Tab shown under the selected goal's header. */
  goalTab: GoalTab
  /** Goal filter applied when opening the Security view from elsewhere (null = all goals). */
  securityGoalId: string | null
  /** Settings section to scroll to (route `#/settings/<section>`); null = top. */
  settingsSection: string | null
  /** The ⌘K command palette is open. */
  paletteOpen: boolean
  /** Text to put in a bot's chat box (e.g. "Ask a bot about this module"); `at` makes each request distinct. */
  chatDraft: { botId: string; text: string; at: number } | null
}

/** Shared empty list so selectors and fallbacks never mint new arrays. */
export const NO_FINDINGS: SecurityFinding[] = []

let warnedFindings = false
/** Store findings only if the server sent a list (older servers 404 or send `{error}`). */
export function setFindings(value: unknown) {
  if (Array.isArray(value)) {
    useAppStore.setState({ findings: value as SecurityFinding[] })
    return
  }
  if (!warnedFindings) {
    warnedFindings = true
    console.warn("[AgentRoom] Security findings unavailable from this server; showing none.")
  }
}

/** Tasks-view selection meaning "tasks that don't belong to any goal". */
export const ALL_TASKS = "__all__"

export const LoadStatus = { Idle: "idle", Loading: "loading", Ready: "ready", Error: "error" } as const
export type LoadStatus = (typeof LoadStatus)[keyof typeof LoadStatus]

export interface AppActions {
  /** Open a bot in the side panel (optionally on a given tab). `null` closes it. */
  select: (id: string | null, tab?: BotTab) => void
  setBotTab: (tab: BotTab) => void
  setView: (v: View) => void
  setBrowserBot: (id: string | null) => void
  setDraggingSkill: (skill: string | null) => void
  selectGoal: (id: string | null) => void
  openTask: (id: string | null) => void
  /** Jump to the Tasks view, optionally focusing a goal and/or task. */
  showOnTasks: (target: { goalId?: string; taskId?: string }) => void
  setGoalTab: (tab: GoalTab) => void
  /** Jump to the Security view, optionally filtered to one goal. */
  showSecurity: (goalId?: string | null) => void
  /** Open Settings at a section (e.g. "integrations"). */
  showSettings: (section?: string | null) => void
  setPaletteOpen: (open: boolean) => void
  /** Open a bot's chat with this text in the box, ready to finish and send. */
  draftToBot: (botId: string, text: string) => void
}

const initialState: AppState = {
  token: "",
  tokenChecked: false,
  connected: false,
  info: null,
  bots: [],
  skills: [],
  tasks: [],
  goals: [],
  notifications: [],
  events: [],
  statuses: {},
  usage: emptyUsage(),
  account: null,
  previews: {},
  consoles: {},
  live: {},
  findings: NO_FINDINGS,
  mcp: null,
  automation: null,
  settings: null,
  models: null,
  modelsStatus: LoadStatus.Idle,
  draggingSkill: null,
  recentSkill: null,
  picking: {},
  attachments: {},
  selectedBot: null,
  botTab: BotTab.Chat,
  browserBot: null,
  view: View.Team,
  selectedGoalId: null,
  selectedTaskId: null,
  goalTab: GoalTab.Tasks,
  securityGoalId: null,
  settingsSection: null,
  paletteOpen: false,
  chatDraft: null,
}

export const useAppStore = create<AppState & AppActions>((set) => ({
  ...initialState,
  select: (id, tab) => set((s) => ({ selectedBot: id, botTab: tab ?? (id === s.selectedBot ? s.botTab : BotTab.Chat) })),
  setBotTab: (botTab) => set({ botTab }),
  setView: (view) => set({ view }),
  setBrowserBot: (browserBot) => set({ browserBot }),
  setDraggingSkill: (draggingSkill) => set({ draggingSkill }),
  selectGoal: (selectedGoalId) => set({ selectedGoalId }),
  openTask: (selectedTaskId) => set({ selectedTaskId }),
  showOnTasks: ({ goalId, taskId }) =>
    set((s) => ({
      view: View.Work,
      selectedGoalId: goalId ?? s.selectedGoalId,
      selectedTaskId: taskId ?? null,
      goalTab: taskId ? GoalTab.Tasks : s.goalTab,
    })),
  setGoalTab: (goalTab) => set({ goalTab }),
  showSecurity: (goalId) => set({ view: View.Security, securityGoalId: goalId ?? null }),
  showSettings: (section) => set({ view: View.Settings, settingsSection: section ?? null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  draftToBot: (botId, text) => set({ selectedBot: botId, botTab: BotTab.Chat, chatDraft: { botId, text, at: Date.now() } }),
}))
