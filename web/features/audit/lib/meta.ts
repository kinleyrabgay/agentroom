import {
  BotIcon,
  CogIcon,
  FilePenLineIcon,
  GitPullRequestIcon,
  HandIcon,
  SendIcon,
  ShieldIcon,
  SmartphoneIcon,
  SquareTerminalIcon,
  TargetIcon,
  UploadIcon,
  UserIcon,
  WalletIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"
import { ActorType, AuditKind } from "@shared"

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
  [AuditKind.Goal]: { label: "Goal", icon: TargetIcon },
}

/** Kinds whose summary is a command or a path (shown in monospace). */
export const MONO_KINDS = new Set<AuditKind>([AuditKind.Command, AuditKind.FileWrite, AuditKind.Push])

export const ACTOR_META: Record<ActorType, { label: string; icon: LucideIcon; className: string }> = {
  [ActorType.Human]: { label: "You", icon: UserIcon, className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  [ActorType.Policy]: { label: "Policy", icon: ShieldIcon, className: "border-border bg-muted/60 text-muted-foreground" },
  [ActorType.Session]: { label: "Session rule", icon: HandIcon, className: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  [ActorType.Remote]: { label: "Remote", icon: SmartphoneIcon, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  [ActorType.Bot]: { label: "Bot", icon: BotIcon, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  [ActorType.System]: { label: "AgentRoom", icon: WorkflowIcon, className: "border-border bg-muted/60 text-muted-foreground" },
}

export const AUDIT_PAGE_SIZE = 50
export const SEARCH_DEBOUNCE_MS = 300
export const ALL = "__all__"
