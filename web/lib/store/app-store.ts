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
  type Settings,
  type Skill,
  type StampedEvent,
  type StatusMap,
  type Task,
  type UsageSummary,
} from "@shared"
import { BotTab, View } from "@/lib/constants"
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
      view: View.Tasks,
      selectedGoalId: goalId ?? s.selectedGoalId,
      selectedTaskId: taskId ?? null,
    })),
}))
