import {
  BugIcon,
  CodeIcon,
  FlaskConicalIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react"
import { GoalStatus, TaskKind, TaskStatus } from "@shared"
import type { Tone } from "@/components/kit/tone"

export const TASK_COLUMNS: {
  status: TaskStatus
  label: string
  hint?: string
  tone: Tone
}[] = [
  { status: TaskStatus.Todo, label: "To do", tone: "neutral" },
  { status: TaskStatus.Doing, label: "In progress", tone: "brand" },
  { status: TaskStatus.Review, label: "Review", hint: "Ready for QA", tone: "warning" },
  { status: TaskStatus.Done, label: "Done", tone: "success" },
]

export const STATUS_LABEL: Record<TaskStatus, string> = {
  [TaskStatus.Todo]: "To do",
  [TaskStatus.Doing]: "In progress",
  [TaskStatus.Review]: "Review",
  [TaskStatus.Done]: "Done",
}

/** Kind badges: icon + label always; the tone is a secondary cue. */
export const KIND_META: Record<TaskKind, { label: string; icon: LucideIcon; tone: Tone }> = {
  [TaskKind.Dev]: { label: "Dev", icon: CodeIcon, tone: "info" },
  [TaskKind.QA]: { label: "QA", icon: FlaskConicalIcon, tone: "brand" },
  [TaskKind.Bug]: { label: "Bug", icon: BugIcon, tone: "danger" },
  [TaskKind.Research]: { label: "Research", icon: SearchIcon, tone: "neutral" },
}

/**
 * Goal status: label, tone, whether it is live (pulsing dot), and `dot` for places that draw their own.
 */
export const GOAL_STATUS_META: Record<GoalStatus, { label: string; tone: Tone; live?: boolean; dot: string }> = {
  [GoalStatus.Planning]: { label: "Planning", tone: "info", live: true, dot: "bg-info animate-pulse" },
  [GoalStatus.AwaitingApproval]: { label: "Needs review", tone: "warning", live: true, dot: "bg-warning animate-pulse" },
  [GoalStatus.Building]: { label: "Building", tone: "brand", live: true, dot: "bg-brand animate-pulse" },
  [GoalStatus.Securing]: { label: "Security review", tone: "danger", live: true, dot: "bg-danger animate-pulse" },
  [GoalStatus.Testing]: { label: "Testing", tone: "brand", live: true, dot: "bg-brand animate-pulse" },
  [GoalStatus.Reporting]: { label: "Reporting", tone: "info", live: true, dot: "bg-info animate-pulse" },
  [GoalStatus.Paused]: { label: "Paused", tone: "warning", dot: "bg-warning" },
  [GoalStatus.Done]: { label: "Done", tone: "success", dot: "bg-success" },
  [GoalStatus.Failed]: { label: "Failed", tone: "danger", dot: "bg-danger" },
  [GoalStatus.Cancelled]: { label: "Cancelled", tone: "neutral", dot: "bg-muted-foreground/50" },
}

/** The visible steps of a goal run, in order. */
export const PHASES = [
  { key: "plan", label: "Plan" },
  { key: "review", label: "Review" },
  { key: "build", label: "Build" },
  { key: "security", label: "Security" },
  { key: "test", label: "Test" },
  { key: "report", label: "Report" },
  { key: "done", label: "Done" },
] as const

export const AUTOSAVE_DELAY_MS = 600
export const UNASSIGNED = "__none__"
