import { ServerIcon, WalletIcon, BellRingIcon, DatabaseIcon, PlugIcon, ShieldIcon, SlidersHorizontalIcon, SmartphoneIcon } from "lucide-react"
import { WorkPhase } from "@shared"

export const AUTOSAVE_MS = 500
export const SAVED_VISIBLE_MS = 2000

/** Settings sections, in page order. */
export const SettingsSection = {
  General: "general",
  Budgets: "budgets",
  Security: "security",
  Alerts: "alerts",
  Remote: "remote",
  Runner: "runner",
  Integrations: "integrations",
  Data: "data",
} as const
export type SettingsSection = (typeof SettingsSection)[keyof typeof SettingsSection]

export const SECTIONS: { id: SettingsSection; label: string; icon: typeof SlidersHorizontalIcon; description: string }[] = [
  { id: SettingsSection.General, label: "General", icon: SlidersHorizontalIcon, description: "Which model each workflow phase uses." },
  { id: SettingsSection.Budgets, label: "Budgets", icon: WalletIcon, description: "Spend caps per goal and per day. Goals pause at a cap instead of overspending." },
  { id: SettingsSection.Security, label: "Security", icon: ShieldIcon, description: "Security review, what blocks commits and PRs, and which paths count as sensitive." },
  { id: SettingsSection.Alerts, label: "Alerts", icon: BellRingIcon, description: "How AgentRoom reaches you when you're away. Personal to this machine." },
  { id: SettingsSection.Remote, label: "Remote approvals", icon: SmartphoneIcon, description: "Approve from your phone through a temporary, approvals-only link." },
  { id: SettingsSection.Runner, label: "Runner", icon: ServerIcon, description: "Where schedules and triggers run. Background mode keeps them running with the tab closed." },
  { id: SettingsSection.Integrations, label: "Integrations", icon: PlugIcon, description: "Services AgentRoom connects to." },
  { id: SettingsSection.Data, label: "Data", icon: DatabaseIcon, description: "What AgentRoom keeps, where, and for how long." },
]

/** Phases a model can be chosen for, in workflow order (chat uses each bot's own setting). */
export const PHASES: { id: Exclude<WorkPhase, typeof WorkPhase.Chat>; label: string; hint: string }[] = [
  { id: WorkPhase.Planning, label: "Planning", hint: "Planner investigates and drafts tasks" },
  { id: WorkPhase.Build, label: "Build", hint: "Developer implements each task" },
  { id: WorkPhase.Security, label: "Security review", hint: "Security Auditor reviews risky changes" },
  { id: WorkPhase.Testing, label: "Testing", hint: "QA verifies the work" },
  { id: WorkPhase.Reporting, label: "Reporting", hint: "Team Lead writes the final report" },
]

/** Files AgentRoom writes, and whether they're shared through git. */
export const DATA_FILES: { path: string; committed: boolean; what: string }[] = [
  { path: ".agentroom/settings.json", committed: true, what: "These settings: models per phase, budgets, security policy" },
  { path: ".agentroom/bots/, skills/, tasks/", committed: true, what: "Your team, its skills, goals and tasks" },
  { path: ".agentroom/github/project.json", committed: true, what: "The connected GitHub board and its columns" },
  { path: ".agentroom/runs/audit.jsonl", committed: false, what: "Audit log: commands, file writes, pushes, approvals" },
  { path: ".agentroom/runs/ledger.jsonl", committed: false, what: "One row per bot run: cost, tokens, duration, outcome" },
  { path: ".agentroom/runs/secrets.json", committed: false, what: "Integration secrets (webhooks, SMTP); never sent back to the UI" },
  { path: ".agentroom/runs/alerts.json", committed: false, what: "Your alert preferences" },
]

export const RETENTION_LIMITS = { min: 1, max: 3650 } as const
