import {
  BugIcon,
  CodeIcon,
  FlaskConicalIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react"
import { GoalStatus, TaskKind, TaskStatus } from "@shared"

export const TASK_COLUMNS: {
  status: TaskStatus
  label: string
  hint?: string
  dot: string
}[] = [
  { status: TaskStatus.Todo, label: "To do", dot: "bg-muted-foreground/50" },
  { status: TaskStatus.Doing, label: "In progress", dot: "bg-sky-400" },
  {
    status: TaskStatus.Review,
    label: "Review",
    hint: "Ready for QA",
    dot: "bg-amber-400",
  },
  { status: TaskStatus.Done, label: "Done", dot: "bg-emerald-400" },
]

export const STATUS_LABEL: Record<TaskStatus, string> = {
  [TaskStatus.Todo]: "To do",
  [TaskStatus.Doing]: "In progress",
  [TaskStatus.Review]: "Review",
  [TaskStatus.Done]: "Done",
}

/** Kind badges: icon + label always; color is a secondary cue. */
export const KIND_META: Record<
  TaskKind,
  { label: string; icon: LucideIcon; className: string }
> = {
  [TaskKind.Dev]: {
    label: "Dev",
    icon: CodeIcon,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  [TaskKind.QA]: {
    label: "QA",
    icon: FlaskConicalIcon,
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  [TaskKind.Bug]: {
    label: "Bug",
    icon: BugIcon,
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  [TaskKind.Research]: {
    label: "Research",
    icon: SearchIcon,
    className: "border-border bg-muted text-muted-foreground",
  },
}

export const GOAL_STATUS_META: Record<
  GoalStatus,
  { label: string; dot: string }
> = {
  [GoalStatus.Planning]: { label: "Planning", dot: "bg-sky-400 animate-pulse" },
  [GoalStatus.AwaitingApproval]: {
    label: "Needs review",
    dot: "bg-amber-400 animate-pulse",
  },
  [GoalStatus.Building]: { label: "Building", dot: "bg-sky-400 animate-pulse" },
  [GoalStatus.Securing]: {
    label: "Security review",
    dot: "bg-red-400 animate-pulse",
  },
  [GoalStatus.Testing]: {
    label: "Testing",
    dot: "bg-violet-400 animate-pulse",
  },
  [GoalStatus.Reporting]: {
    label: "Reporting",
    dot: "bg-sky-400 animate-pulse",
  },
  [GoalStatus.Paused]: { label: "Paused", dot: "bg-amber-400" },
  [GoalStatus.Done]: { label: "Done", dot: "bg-emerald-500" },
  [GoalStatus.Failed]: { label: "Failed", dot: "bg-destructive" },
  [GoalStatus.Cancelled]: { label: "Cancelled", dot: "bg-muted-foreground/50" },
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
