import type { SentryIssueQuery, SentryLevel, SentryPeriod, SentrySort } from "@shared"
import type { Tone } from "@/components/kit/tone"
import type { NewBotDefaults } from "@/features/team/components/new-bot-dialog"

/** Refresh cadence while the page is visible. */
export const POLL_MS = 60_000
export const FILTERS_STORAGE_KEY = "agentroom.sentry.filters"
export const TOKEN_URL = "https://sentry.io/settings/account/api/auth-tokens/"
export const TOKEN_SCOPES = ["org:read", "project:read", "event:read"]

export type IssueStatusFilter = NonNullable<SentryIssueQuery["status"]>
export type AssignedFilter = NonNullable<SentryIssueQuery["assigned"]>

/** Filters the page keeps (and remembers between visits). */
export interface SentryFilters {
  query: string
  projects: string[]
  environment: string
  status: IssueStatusFilter
  level: SentryLevel | ""
  assigned: AssignedFilter
  sort: SentrySort
  period: SentryPeriod
}

export const DEFAULT_FILTERS: SentryFilters = {
  query: "",
  projects: [],
  environment: "",
  status: "unresolved",
  level: "",
  assigned: "any",
  sort: "date",
  period: "14d",
}

export const STATUS_OPTIONS: { value: IssueStatusFilter; label: string }[] = [
  { value: "unresolved", label: "Unresolved" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All statuses" },
]

export const LEVEL_OPTIONS: { value: SentryLevel | ""; label: string }[] = [
  { value: "", label: "Any level" },
  { value: "fatal", label: "Fatal" },
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
]

export const ASSIGNED_OPTIONS: { value: AssignedFilter; label: string }[] = [
  { value: "any", label: "Anyone" },
  { value: "me", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
]

export const PERIOD_OPTIONS: { value: SentryPeriod; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
]

export const SORT_OPTIONS: { value: SentrySort; label: string }[] = [
  { value: "date", label: "Last seen" },
  { value: "new", label: "First seen" },
  { value: "freq", label: "Events" },
  { value: "user", label: "Users" },
]

/** Level → tone (badges, dots). */
export const LEVEL_META: Record<string, { label: string; tone: Tone }> = {
  fatal: { label: "Fatal", tone: "danger" },
  error: { label: "Error", tone: "danger" },
  warning: { label: "Warning", tone: "warning" },
  info: { label: "Info", tone: "info" },
  debug: { label: "Debug", tone: "neutral" },
}
export const levelMeta = (level: string) => LEVEL_META[level] ?? LEVEL_META.debug!

/** Substatus badges worth calling out. */
export const SUBSTATUS_META: Record<string, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "info" },
  regressed: { label: "Regressed", tone: "danger" },
  escalating: { label: "Escalating", tone: "warning" },
}

/** Sentry's issue priority → tone. */
export const PRIORITY_TONE: Record<string, Tone> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
}

/** "+ New bot" in the hand-off form: a bot made for fixing Sentry issues. */
export const BUG_FIXER: NewBotDefaults = {
  name: "Bug Fixer",
  role: "bug-fixer",
  prompt:
    "You fix production errors reported by Sentry. Reproduce from the stack trace, find the in-app frame that fails, " +
    "write a failing test that shows the bug, fix it with the smallest safe change, and verify the test passes. " +
    "Mention the Sentry short id (e.g. WEB-1A2) in your commit message.",
}
