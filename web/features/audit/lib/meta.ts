import {
  BotIcon,
  CogIcon,
  PlugIcon,
  CalendarClockIcon,
  FilePenLineIcon,
  GitPullRequestIcon,
  HandIcon,
  InboxIcon,
  SendIcon,
  ShieldIcon,
  SmartphoneIcon,
  SquareTerminalIcon,
  TargetIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"
import { ActorType, AuditKind } from "@shared"
import type { Tone } from "@/components/kit/tone"

export const KIND_META: Record<AuditKind, { label: string; icon: LucideIcon }> = {
  [AuditKind.Command]: { label: "Command", icon: SquareTerminalIcon },
  [AuditKind.FileWrite]: { label: "File write", icon: FilePenLineIcon },
  [AuditKind.Push]: { label: "Push", icon: UploadIcon },
  [AuditKind.PullRequest]: { label: "Pull request", icon: GitPullRequestIcon },
  [AuditKind.GithubWrite]: { label: "GitHub write", icon: GitPullRequestIcon },
  [AuditKind.Approval]: { label: "Approval", icon: HandIcon },
  [AuditKind.Handoff]: { label: "Hand-off", icon: SendIcon },
  [AuditKind.Budget]: { label: "Budget", icon: WalletIcon },
  [AuditKind.Security]: { label: "Security", icon: ShieldIcon },
  [AuditKind.Settings]: { label: "Settings", icon: CogIcon },
  [AuditKind.Mcp]: { label: "MCP", icon: PlugIcon },
  [AuditKind.Automation]: { label: "Automation", icon: CalendarClockIcon },
  [AuditKind.Goal]: { label: "Goal", icon: TargetIcon },
  [AuditKind.Intake]: { label: "Intake", icon: InboxIcon },
}

/** Kinds whose summary is a command or a path (shown in monospace). */
export const MONO_KINDS = new Set<AuditKind>([AuditKind.Command, AuditKind.FileWrite, AuditKind.Push])

export const ACTOR_META: Record<ActorType, { label: string; icon: LucideIcon; tone: Tone }> = {
  [ActorType.Human]: { label: "You", icon: UserIcon, tone: "info" },
  [ActorType.Policy]: { label: "Policy", icon: ShieldIcon, tone: "neutral" },
  [ActorType.Session]: { label: "Session rule", icon: HandIcon, tone: "brand" },
  [ActorType.Remote]: { label: "Remote", icon: SmartphoneIcon, tone: "warning" },
  [ActorType.Bot]: { label: "Bot", icon: BotIcon, tone: "success" },
  [ActorType.System]: { label: "AgentRoom", icon: WorkflowIcon, tone: "neutral" },
  [ActorType.External]: { label: "Teams", icon: UsersIcon, tone: "brand" },
}

export const AUDIT_PAGE_SIZE = 50
export const SEARCH_DEBOUNCE_MS = 300
export const ALL = "__all__"
