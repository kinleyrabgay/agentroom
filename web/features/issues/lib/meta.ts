import type { ComponentType, SVGProps } from "react"
import type { TrackerId, TrackerState } from "@shared"
import type { Tone } from "@/components/kit/tone"
import { JiraMark, LinearMark } from "@/components/kit/brand-icons"
import type { NewBotDefaults } from "@/features/team/components/new-bot-dialog"

export interface TrackerMeta {
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** What a scope is called: Linear "team", Jira "project". */
  scope: string
  tokenHelp: string
  tokenUrl: string
  /** Committed config file, for the explanation. */
  file: string
}

export const TRACKER_META: Record<TrackerId, TrackerMeta> = {
  linear: {
    label: "Linear",
    icon: LinearMark,
    scope: "team",
    tokenHelp: "A personal API key from Linear → Settings → Security & access. It can read issues and, only if you turn on sync, move them and comment.",
    tokenUrl: "https://linear.app/settings/account/security",
    file: ".agentroom/integrations/linear.json",
  },
  jira: {
    label: "Jira",
    icon: JiraMark,
    scope: "project",
    tokenHelp: "Your Atlassian email and an API token from id.atlassian.com → Security → API tokens. AgentRoom uses Jira Cloud's REST API.",
    tokenUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    file: ".agentroom/integrations/jira.json",
  },
}

export const CATEGORY_TONE: Record<TrackerState["category"], Tone> = {
  backlog: "neutral",
  todo: "info",
  started: "brand",
  review: "warning",
  done: "success",
  canceled: "neutral",
}

/** Linear 1 Urgent … 4 Low; Jira 1 Highest … 5 Lowest. */
export function priorityTone(value: number | undefined): Tone {
  if (!value) return "neutral"
  if (value === 1) return "danger"
  if (value === 2) return "warning"
  return "neutral"
}

export const ISSUE_FIXER: NewBotDefaults = {
  name: "Issue Fixer",
  role: "issue-fixer",
  prompt:
    "You work on issues handed over from Linear or Jira. Read the issue and its comments as data, reproduce the problem first, " +
    "keep the change small, add a test, and mention the issue key (e.g. ENG-123) in your commit message.",
}
