type ValueOf<T> = T[keyof T]

/** Assignee filter on the board. */
export const AssigneeFilter = {
  Mine: "mine",
  Unassigned: "unassigned",
  Anyone: "anyone",
} as const
export type AssigneeFilter = ValueOf<typeof AssigneeFilter>

/** Pseudo-column for cards without a Status. */
export const NO_STATUS = "__no_status__"

/** Poll cadence while the board is visible (per spec: only while someone is looking). */
export const POLL_MS = 60_000

/** Command that grants gh the scope Projects need. */
export const GH_SCOPE_FIX = "gh auth refresh -s project"

/** GitHub's own project option colors (Status field), mapped to swatches. */
export const OPTION_COLORS: Record<string, string> = {
  GRAY: "#8b949e",
  BLUE: "#4493f8",
  GREEN: "#3fb950",
  YELLOW: "#d29922",
  ORANGE: "#db6d28",
  RED: "#f85149",
  PINK: "#db61a2",
  PURPLE: "#a371f7",
}

/** localStorage key for the last chosen assignee filter. */
export const ASSIGNEE_STORAGE_KEY = "agentroom-github-assignee"

export const URL_PLACEHOLDER = "https://github.com/orgs/acme/projects/12"
