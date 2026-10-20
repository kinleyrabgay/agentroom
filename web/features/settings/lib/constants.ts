import { ClapperboardIcon, GaugeIcon, SirenIcon } from "lucide-react"
import { PackageIcon, UsersIcon, WaypointsIcon, ServerIcon, WalletIcon, BellRingIcon, DatabaseIcon, PlugIcon, ShieldIcon, SlidersHorizontalIcon, SmartphoneIcon } from "lucide-react"
import { WorkPhase } from "@shared"

export const AUTOSAVE_MS = 500
export const SAVED_VISIBLE_MS = 2000

/** Settings sections, in page order. */
export const SettingsSection = {
  General: "general",
  Budgets: "budgets",
  Security: "security",
  Context: "context",
  Proof: "proof",
  Quality: "quality",
  Autopilot: "autopilot",
  Packs: "packs",
  Alerts: "alerts",
  Remote: "remote",
  Room: "room",
  Runner: "runner",
  Integrations: "integrations",
  Data: "data",
} as const
export type SettingsSection = (typeof SettingsSection)[keyof typeof SettingsSection]

export const SECTIONS: { id: SettingsSection; label: string; icon: typeof SlidersHorizontalIcon; description: string }[] = [
  { id: SettingsSection.General, label: "General", icon: SlidersHorizontalIcon, description: "Which model each workflow phase uses." },
  { id: SettingsSection.Budgets, label: "Budgets", icon: WalletIcon, description: "Spend caps per goal and per day. Goals pause at a cap instead of overspending." },
  { id: SettingsSection.Security, label: "Security", icon: ShieldIcon, description: "Security review, what blocks commits and PRs, and which paths count as sensitive." },
  { id: SettingsSection.Context, label: "Context", icon: WaypointsIcon, description: "The repo map bots read instead of exploring, and the cards written about each module." },
  { id: SettingsSection.Proof, label: "Proof", icon: ClapperboardIcon, description: "The Verify step: open the app in a headless browser, record the feature working, attach it to the PR." },
  { id: SettingsSection.Quality, label: "Quality", icon: GaugeIcon, description: "Checks run while verifying. A failing check pauses the goal until you accept it." },
  { id: SettingsSection.Autopilot, label: "Autopilot", icon: SirenIcon, description: "Sentry incidents fixed reproduce-first. When, if ever, autopilot may open a PR on its own." },
  { id: SettingsSection.Packs, label: "Packs", icon: PackageIcon, description: "Ready-made teams for your stack, and the registries Browse skills searches." },
  { id: SettingsSection.Alerts, label: "Alerts", icon: BellRingIcon, description: "How AgentRoom reaches you when you're away. Personal to this machine." },
  { id: SettingsSection.Remote, label: "Remote approvals", icon: SmartphoneIcon, description: "Approve from your phone through a temporary, approvals-only link." },
  { id: SettingsSection.Room, label: "Team room", icon: UsersIcon, description: "Teammates watch, approve and comment from their own browser. Everything runs on this machine." },
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
  { path: ".agentroom/settings.json, config.json", committed: true, what: "Team settings: models per phase, budgets, security policy" },
  { path: ".agentroom/bots/, skills/, goal-templates/", committed: true, what: "Your team, its skills, memory and goal templates" },
  { path: ".agentroom/mcp.json, sentry.json, github/", committed: true, what: "Team integrations (tokens are references, never values)" },
  { path: ".agentroom/schedules.json, triggers.json", committed: true, what: "Team automation; each item runs only on its owner's machine" },
  { path: ".agentroom/context/", committed: true, what: "Repo map (INDEX.md) and module cards, with your notes and decisions" },
  { path: ".agentroom/runs/board.json", committed: false, what: "Your goals and tasks" },
  { path: ".agentroom/runs/settings.local.json, config.local.json", committed: false, what: "Your personal overrides (port, permission mode, models…)" },
  { path: ".agentroom/runs/schedules.json, triggers.json", committed: false, what: "Your personal automation" },
  { path: ".agentroom/runs/audit.jsonl, ledger.jsonl", committed: false, what: "Audit log and one row per bot run" },
  { path: ".agentroom/runs/secrets.json", committed: false, what: "Tokens and webhooks; never sent back to the UI" },
  { path: ".agentroom/runs/proof/", committed: false, what: "Proof recordings, screenshots and quality reports (pushed to agentroom/proof only when a PR opens)" },
]

export const RETENTION_LIMITS = { min: 1, max: 3650 } as const
