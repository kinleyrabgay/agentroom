import type { AutomationRun, AutomationSnapshot, Brief, NextRun, RunnerStatus, Schedule, TimeParse, Trigger, BudgetSummary, GoalChanges, PrDraft, SentryHandoffInput, SentryIssueDetail, SentryIssuePage, SentryIssueQuery, SentryOrg, SentryProject, SentryStatus, McpPreset, McpScope, McpServerEntry, McpSnapshot, McpTransportConfig, FindingQuery, SecurityFinding, SecurityReviewMode, AuditPage, AuditQuery, IntegrationSecrets, IntegrationStatus, LedgerEntry, Settings, SettingsPatch, AlertCapabilities, AlertPrefs, Bot, BotPatch, GithubBoard, GithubItem, GithubItemDetail, GithubProjectConfig, HandoffInput, HandoffResult, Config, EffortLevel, Goal, GoalPatch, NewTaskInput, ProjectInfo, ProviderModels, Skill, SkillInput, Task, TaskPatch } from "@shared"
import { request } from "./client"
import type { BotMemory, GoalTemplateList, MemoryNote, RemoteStatus } from "@shared"
import type { GoalTimeline, Insights, InsightsPeriod } from "@shared"
import type { ProofAvailability, ProofScenario, ProofView } from "@shared"
import type { AutopilotIssueRun } from "@shared"
import type { ContextClaimSection, ContextFilePeek, ContextGraphView, ContextHit, ContextImpact, ContextIndexView, ContextModuleDetail, ContextStatus } from "@shared"
import type { ContextAsk, ContextDocFileId, ContextDocPreview, ContextTour } from "@shared"
import type { CostEstimate, EvalRun, Experiment, ExperimentResult, ExperimentVariant, GoalOutcome, ProviderStatus, Suggestion } from "@shared"

const seg = encodeURIComponent

/** A bot patch where `null` clears model/effort (→ project default) or reportsTo (→ top of team). */
export type BotUpdate = Omit<BotPatch, "model" | "effort" | "reportsTo"> & {
  model?: string | null
  effort?: EffortLevel | null
  reportsTo?: string | null
}

/** A goal patch; the server also accepts the per-goal security review mode. */
export type GoalUpdate = GoalPatch & { securityReview?: SecurityReviewMode }

/** Typed REST calls. File changes come back through the realtime `state` push, so callers rarely need the result. */
export const projectApi = {
  info: () => request<ProjectInfo>("GET", "/info"),
  updateConfig: (patch: Partial<Config>) => request<Config>("PATCH", "/config", patch),
  models: () => request<ProviderModels>("GET", "/models"),
}

export const botApi = {
  create: (name: string, role: string) => request<Bot>("POST", "/bots", { name, role }),
  update: (id: string, patch: BotUpdate) => request<Bot>("PATCH", `/bots/${seg(id)}`, patch),
  remove: (id: string) => request("DELETE", `/bots/${seg(id)}`),
  resetSession: (id: string) => request("POST", `/bots/${seg(id)}/reset`),

  assignSkill: (bot: Bot, skill: string) =>
    bot.skills.includes(skill) ? Promise.resolve(bot) : botApi.update(bot.id, { skills: [...bot.skills, skill] }),
  unassignSkill: (bot: Bot, skill: string) => botApi.update(bot.id, { skills: bot.skills.filter((s) => s !== skill) }),

  saveSkill: (botId: string, skill: SkillInput) =>
    request<Skill>("PUT", `/bots/${seg(botId)}/skills/${seg(skill.name)}`, { description: skill.description, body: skill.body }),
  deleteSkill: (botId: string, name: string) => request("DELETE", `/bots/${seg(botId)}/skills/${seg(name)}`),
  /** Copy a library skill into the bot's own folder so it can be edited for this bot only. */
  customizeSkill: (botId: string, name: string) => request<Bot>("POST", `/bots/${seg(botId)}/skills/${seg(name)}/customize`),
}

export const skillApi = {
  save: (skill: SkillInput) => request<Skill>("PUT", `/skills/${seg(skill.name)}`, skill),
  remove: (name: string) => request("DELETE", `/skills/${seg(name)}`),
}

/** A task patch where `null` clears the assignee or the blocked reason. */
export type TaskUpdate = Omit<TaskPatch, "assignee" | "blockedReason"> & {
  assignee?: string | null
  blockedReason?: string | null
}

export type TaskCreate = Omit<NewTaskInput, "acceptance" | "createdBy"> & { acceptance?: string[] }

export const taskApi = {
  create: (input: TaskCreate) => request<Task>("POST", "/tasks", input),
  update: (id: string, patch: TaskUpdate) => request<Task>("PATCH", `/tasks/${seg(id)}`, patch),
  remove: (id: string) => request("DELETE", `/tasks/${seg(id)}`),
}

/** Goal runs: plan → human review → build → test → report. */
export const goalApi = {
  list: () => request<Goal[]>("GET", "/goals"),
  create: (brief: string, title?: string, securityReview?: SecurityReviewMode, attachments?: string[], extra?: GoalStartExtra) =>
    request<Goal>("POST", "/goals", { brief, title, securityReview, attachments, ...extra }),
  update: (id: string, patch: GoalUpdate) => request<Goal>("PATCH", `/goals/${seg(id)}`, patch),
  approve: (id: string) => request<Goal>("POST", `/goals/${seg(id)}/approve`),
  replan: (id: string, feedback: string) => request<Goal>("POST", `/goals/${seg(id)}/replan`, { feedback }),
  pause: (id: string) => request<Goal>("POST", `/goals/${seg(id)}/pause`),
  resume: (id: string) => request<Goal>("POST", `/goals/${seg(id)}/resume`),
  cancel: (id: string) => request<Goal>("POST", `/goals/${seg(id)}/cancel`),
  remove: (id: string) => request("DELETE", `/goals/${seg(id)}`),
}

/** Personal alerts: OS notifications, sound and voice when you're away from AgentRoom. */
export const alertApi = {
  get: () => request<{ prefs: AlertPrefs; capabilities: AlertCapabilities }>("GET", "/alerts"),
  update: (patch: Partial<AlertPrefs>) => request<AlertPrefs>("PUT", "/alerts", patch),
  test: () => request("POST", "/alerts/test"),
}

/** The GitHub project board (read-only mirror; the only write is assigning yourself). */
export const githubApi = {
  get: () => request<{ project: GithubProjectConfig | null }>("GET", "/github"),
  connect: (url: string) => request<GithubProjectConfig>("PUT", "/github", { url }),
  disconnect: () => request("DELETE", "/github"),
  syncColumns: () => request<GithubProjectConfig>("POST", "/github/sync-columns"),
  setHiddenColumns: (hiddenColumns: string[]) => request<GithubProjectConfig>("PATCH", "/github", { hiddenColumns }),
  /** Without `refresh` the server answers from its cache instantly. */
  items: (refresh = false) => request<GithubBoard>("GET", `/github/items${refresh ? "?refresh=1" : ""}`),
  item: (id: string) => request<GithubItemDetail>("GET", `/github/items/${seg(id)}`),
  assign: (id: string, assign: boolean) => request<GithubItem>("POST", `/github/items/${seg(id)}/assign`, { assign }),
  handoff: (input: HandoffInput) => request<HandoffResult>("POST", "/github/handoff", input),
}

/** Repo files (git ls-files), markdown first. */
export const filesApi = {
  search: (q: string, limit = 20) => request<string[]>("GET", `/files?q=${seg(q)}&limit=${limit}`),
}

/** Build a query string from defined values only. */
const qs = (params: Record<string, string | number | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${seg(String(v))}`)
    .join("&")
  return q ? `?${q}` : ""
}

/** Team-wide settings (`.agentroom/settings.json`). PATCH merges per section. */
export const settingsApi = {
  get: () => request<Settings>("GET", "/settings"),
  /** `personal` saves to your own overlay (runs/settings.local.json) instead of the team file. */
  update: (patch: SettingsPatch, scope: "team" | "personal" = "team") =>
    request<Settings>("PATCH", `/settings${scope === "personal" ? "?scope=personal" : ""}`, patch),
  /** Drop a personal override (dotted key) so the team value applies again. */
  resetPersonal: (key: string) => request<Settings>("DELETE", `/settings/personal?key=${seg(key)}`),
}

/** Append-only audit log, newest first. Paginate with `before` (ISO of the last entry seen). */
export const auditApi = {
  list: (query: AuditQuery) => request<AuditPage>("GET", `/audit${qs({ ...query })}`),
}

/** One row per bot run: cost, tokens, duration, outcome. */
export const ledgerApi = {
  list: (query: { goalId?: string; botId?: string; since?: string }) => request<LedgerEntry[]>("GET", `/ledger${qs(query)}`),
}

/** Local integration secrets (never returned, only whether each is set). */
export const integrationsApi = {
  get: () => request<IntegrationStatus>("GET", "/integrations"),
  update: (patch: Partial<IntegrationSecrets>) => request<IntegrationStatus>("PUT", "/integrations", patch),
}

/** Security findings: scanner, dependency guard, security review, prompt-injection guard. */
export const securityApi = {
  findings: (query: FindingQuery) => request<SecurityFinding[]>("GET", `/security/findings${qs({ ...query })}`),
  resolve: (id: string, status: "approved" | "dismissed", note?: string) =>
    request<SecurityFinding>("POST", `/security/findings/${seg(id)}/resolve`, { status, note }),
  scan: (goalId?: string) => request<SecurityFinding[]>("POST", "/security/scan", goalId ? { goalId } : {}),
}

/** External MCP servers (Sentry, …): status, add/remove, bot access, secrets (write-only) and browser sign-in. */
export const mcpApi = {
  get: () => request<McpSnapshot>("GET", "/mcp"),
  presets: () => request<McpPreset[]>("GET", "/mcp/presets"),
  refresh: () => request<McpSnapshot>("POST", "/mcp/refresh"),
  add: (input: { name: string; config: McpTransportConfig; scope: McpScope; bots?: string[]; description?: string; preset?: string; secrets?: Record<string, string> }) =>
    request<McpServerEntry>("POST", "/mcp/servers", input),
  import: (name: string) => request<McpServerEntry>("POST", "/mcp/import", { name }),
  update: (name: string, patch: { enabled?: boolean; bots?: string[]; scope?: McpScope }) =>
    request<McpServerEntry>("PATCH", `/mcp/servers/${seg(name)}`, patch),
  remove: (name: string) => request<{ ok: true }>("DELETE", `/mcp/servers/${seg(name)}`),
  setSecrets: (name: string, values: Record<string, string>) => request<{ ok: true }>("PUT", `/mcp/servers/${seg(name)}/secrets`, values),
  signIn: (name: string) =>
    request<{ connected: true } | { connected: false; url: string; external?: boolean }>("POST", `/mcp/servers/${seg(name)}/sign-in`),
}

/** Sentry issues (REST API with the local SENTRY_ACCESS_TOKEN). Read-only except hand-offs to bots. */
export const sentryApi = {
  status: () => request<SentryStatus>("GET", "/sentry"),
  setToken: (token: string, host?: string) => request<{ orgs: SentryOrg[] }>("PUT", "/sentry/token", { token, ...(host ? { host } : {}) }),
  orgs: () => request<SentryOrg[]>("GET", "/sentry/orgs"),
  projects: (org: string) => request<SentryProject[]>("GET", `/sentry/projects${qs({ org })}`),
  environments: () => request<string[]>("GET", "/sentry/environments"),
  connect: (input: { org: string; projects: string[]; environment?: string; host?: string }) => request<SentryStatus>("PUT", "/sentry", input),
  disconnect: () => request<{ ok: true }>("DELETE", "/sentry"),
  issues: (q: SentryIssueQuery) =>
    request<SentryIssuePage>(
      "GET",
      `/sentry/issues${qs({
        query: q.query,
        projects: q.projects?.length ? q.projects.join(",") : undefined,
        environment: q.environment,
        status: q.status,
        level: q.level,
        assigned: q.assigned,
        sort: q.sort,
        period: q.period,
        cursor: q.cursor,
      })}`
    ),
  issue: (id: string) => request<SentryIssueDetail>("GET", `/sentry/issues/${seg(id)}`),
  handoff: (input: SentryHandoffInput) => request<HandoffResult>("POST", "/sentry/handoff", input),
}

/** Replay and Insights: read-only views over the run ledger, event logs and audit log. */
export const insightsApi = {
  timeline: (goalId: string) => request<GoalTimeline>("GET", `/goals/${seg(goalId)}/timeline`),
  get: (period: InsightsPeriod) => request<Insights>("GET", `/insights?period=${period}`),
}

/** Extra goal-start options: a goal template and its filled-in fields, and an optional budget. */
export interface GoalStartExtra {
  templateId?: string
  fields?: Record<string, string>
  budgetUsd?: number
}

/** Goal templates (`.agentroom/goal-templates/*.md`, or the built-in set). */
export const goalTemplateApi = {
  list: () => request<GoalTemplateList>("GET", "/goal-templates"),
  saveDefaults: () => request<GoalTemplateList>("POST", "/goal-templates/save-defaults"),
}

/** Bot memory: notes in bots/<dir>/memory.md and notes the bot suggested. */
export const memoryApi = {
  get: (botId: string) => request<BotMemory>("GET", `/bots/${seg(botId)}/memory`),
  save: (botId: string, notes: MemoryNote[]) => request<BotMemory>("PUT", `/bots/${seg(botId)}/memory`, { notes }),
  keep: (botId: string, id: string, text?: string) => request<BotMemory>("POST", `/bots/${seg(botId)}/memory/suggestions/${seg(id)}/keep`, { text }),
  ignore: (botId: string, id: string) => request<BotMemory>("POST", `/bots/${seg(botId)}/memory/suggestions/${seg(id)}/ignore`),
}

/** Phone approvals: tunnel status (with a QR code while on), turn on, revoke. */
export const remoteApi = {
  get: () => request<RemoteStatus & { qrSvg?: string }>("GET", "/remote"),
  enable: (hours: number) => request<RemoteStatus & { qrSvg?: string }>("POST", "/remote/enable", { hours }),
  disable: () => request<RemoteStatus>("POST", "/remote/disable"),
}

/** A goal's own branch: diff review, review comments, per-task revert, PR, local merge, cleanup. */
export const goalWorkApi = {
  changes: (id: string) => request<GoalChanges>("GET", `/goals/${seg(id)}/changes`),
  addComment: (id: string, comment: { file: string; line?: number; body: string }) => request<Goal>("POST", `/goals/${seg(id)}/comments`, comment),
  deleteComment: (id: string, commentId: string) => request<Goal>("DELETE", `/goals/${seg(id)}/comments/${seg(commentId)}`),
  requestChanges: (id: string) => request<Goal>("POST", `/goals/${seg(id)}/request-changes`),
  revertTask: (id: string, taskId: string) => request<Task>("POST", `/goals/${seg(id)}/tasks/${seg(taskId)}/revert`),
  prDraft: (id: string) => request<PrDraft>("GET", `/goals/${seg(id)}/pr-draft`),
  openPr: (id: string, input: { title: string; body: string; draft: boolean }) => request<Goal>("POST", `/goals/${seg(id)}/pr`, input),
  mergeLocal: (id: string) => request<Goal>("POST", `/goals/${seg(id)}/merge-local`),
  cleanup: (id: string) => request<Goal>("POST", `/goals/${seg(id)}/cleanup`),
}

/** Spend today and per goal, against the caps in Settings → Budgets. */
export const budgetApi = {
  summary: () => request<BudgetSummary>("GET", "/budgets"),
}

/** Schedules, triggers, history, the brief, time parsing and background mode. */
export const automationApi = {
  get: () => request<AutomationSnapshot>("GET", "/automation"),
  next: () => request<NextRun | null>("GET", "/automation/next"),
  history: (limit = 100) => request<AutomationRun[]>("GET", `/automation/history?limit=${limit}`),
  seen: () => request<{ ok: true }>("POST", "/automation/seen"),
  parse: (text: string) => request<TimeParse>("POST", "/schedule/parse", { text }),
  createSchedule: (input: ScheduleInput) => request<Schedule>("POST", "/schedules", input),
  updateSchedule: (id: string, patch: Partial<ScheduleInput>) => request<Schedule>("PATCH", `/schedules/${seg(id)}`, patch),
  deleteSchedule: (id: string) => request<{ ok: true }>("DELETE", `/schedules/${seg(id)}`),
  runNow: (id: string) => request<AutomationRun>("POST", `/schedules/${seg(id)}/run-now`),
  createTrigger: (input: TriggerInput) => request<Trigger>("POST", "/triggers", input),
  updateTrigger: (id: string, patch: Partial<TriggerInput>) => request<Trigger>("PATCH", `/triggers/${seg(id)}`, patch),
  deleteTrigger: (id: string) => request<{ ok: true }>("DELETE", `/triggers/${seg(id)}`),
  testTrigger: (id: string) => request<{ wouldFire: boolean; reason?: string; event?: string; action: string }>("POST", `/triggers/${seg(id)}/test`),
  brief: () => request<Brief | null>("GET", "/brief"),
  dismissBrief: () => request<{ ok: true }>("POST", "/brief/dismiss"),
}

/** Background mode (macOS LaunchAgent). */
export const runnerApi = {
  status: () => request<RunnerStatus>("GET", "/runner"),
  install: () => request<RunnerStatus>("POST", "/runner/install"),
  uninstall: () => request<RunnerStatus>("POST", "/runner/uninstall"),
}

export type ScheduleInput = Pick<Schedule, "name" | "when" | "action"> & Partial<Pick<Schedule, "enabled" | "runner" | "scope">> & { owner?: "me" }
export type TriggerInput = Pick<Trigger, "name" | "when" | "then"> & Partial<Pick<Trigger, "enabled" | "runner" | "limits" | "scope">> & { owner?: "me" }

/** Repo context: the module map bots read, its cards, and the human's feedback on them. */
export const contextApi = {
  status: () => request<ContextStatus>("GET", "/context/status"),
  graph: () => request<ContextGraphView>("GET", "/context/graph"),
  index: () => request<ContextIndexView>("GET", "/context/index"),
  files: () => request<string[]>("GET", "/context/files"),
  module: (id: string) => request<ContextModuleDetail>("GET", `/context/module/${seg(id)}`),
  peek: (path: string, line?: number) => request<ContextFilePeek>("GET", `/context/file${qs({ path, line })}`),
  peekRange: (path: string, start: number, end: number) => request<ContextFilePeek>("GET", `/context/file${qs({ path, start, end })}`),
  find: (q: string, limit = 20) => request<ContextHit[]>("GET", `/context/find${qs({ q, limit })}`),
  impact: (files: string[]) => request<ContextImpact>("POST", "/context/impact", { files }),
  sync: (input: { full?: boolean; only?: string[]; cards?: boolean } = {}) => request<ContextStatus>("POST", "/context/sync", input),
  setNotes: (id: string, text: string) => request<ContextModuleDetail>("PUT", `/context/module/${seg(id)}/notes`, { text }),
  reject: (id: string, section: ContextClaimSection, index: number, reason: string) =>
    request<ContextModuleDetail>("POST", `/context/module/${seg(id)}/claims/${section}/${index}/reject`, { reason }),
  setDecisions: (id: string, decisions: string[]) => request<ContextModuleDetail>("PATCH", `/context/module/${seg(id)}/decisions`, { decisions }),
  asks: () => request<ContextAsk[]>("GET", "/context/asks"),
  ask: (question: string) => request<ContextAsk>("POST", "/context/ask", { question }),
  deleteAsk: (id: string) => request<ContextAsk[]>("DELETE", `/context/asks/${seg(id)}`),
  pinAsk: (id: string, moduleId: string) => request<ContextAsk>("POST", `/context/asks/${seg(id)}/pin`, { moduleId }),
  docs: () => request<ContextDocPreview[]>("GET", "/context/docs"),
  writeDoc: (id: ContextDocFileId, sections?: string[]) => request<ContextDocPreview>("POST", `/context/docs/${id}/write`, sections ? { sections } : {}),
  tour: () => request<ContextTour>("GET", "/context/tour"),
  tourProgress: (patch: { done?: Record<string, boolean>; current?: string | null; reset?: boolean }) => request<ContextTour>("PATCH", "/context/tour", patch),
}

/** Proof of work: report, frames, re-run, scenario edits, accepting failing checks. */
export const proofApi = {
  availability: () => request<ProofAvailability>("GET", "/proof/availability"),
  get: (goalId: string) => request<ProofView>("GET", `/goals/${seg(goalId)}/proof`),
  run: (goalId: string) => request<Goal>("POST", `/goals/${seg(goalId)}/proof/run`),
  override: (goalId: string) => request<Goal>("POST", `/goals/${seg(goalId)}/proof/override`),
  setScenarios: (goalId: string, scenarios: ProofScenario[]) => request<ProofScenario[]>("PUT", `/goals/${seg(goalId)}/proof/scenarios`, { scenarios }),
}

/** Incident autopilot (Sentry → reproduce → failing test → fix → verify). */
export const autopilotApi = {
  start: (issueId: string) => request<Goal>("POST", `/autopilot/sentry/${seg(issueId)}`),
  runs: (issueId: string) => request<AutopilotIssueRun[]>("GET", `/autopilot/sentry/${seg(issueId)}`),
  verify: (goalId: string) => request<Goal>("POST", `/goals/${seg(goalId)}/autopilot/verify`),
}

/** Providers, routing estimate and the learning loop (experiments, suggestions, replay evals). */
export const engineApi = {
  providers: () => request<ProviderStatus[]>("GET", "/engine/providers"),
  /** Write-only: the key is never sent back. Empty string removes it. */
  setKey: (provider: string, key: string) => request<{ ok: true }>("PUT", `/engine/providers/${seg(provider)}/key`, { key }),
  estimate: () => request<CostEstimate>("GET", "/engine/estimate"),
  outcomes: () => request<GoalOutcome[]>("GET", "/engine/outcomes"),
  refreshOutcomes: () => request<GoalOutcome[]>("POST", "/engine/outcomes/refresh"),
  experiments: () => request<ExperimentResult[]>("GET", "/engine/experiments"),
  createExperiment: (input: { name: string; botId: string; phase?: string; change: Partial<ExperimentVariant> }) =>
    request<Experiment>("POST", "/engine/experiments", input),
  updateExperiment: (id: string, patch: { status?: "running" | "stopped"; name?: string }) => request<Experiment>("PATCH", `/engine/experiments/${seg(id)}`, patch),
  deleteExperiment: (id: string) => request<{ ok: true }>("DELETE", `/engine/experiments/${seg(id)}`),
  suggestions: () => request<Suggestion[]>("GET", "/engine/suggestions"),
  applySuggestion: (id: string, mode: "apply" | "experiment") => request<{ applied: string }>("POST", `/engine/suggestions/${seg(id)}/apply`, { mode }),
  dismissSuggestion: (id: string) => request<{ ok: true }>("POST", `/engine/suggestions/${seg(id)}/dismiss`),
  evals: () => request<EvalRun[]>("GET", "/engine/evals"),
  startEval: (input: { goalId: string; botId?: string; variant: Partial<ExperimentVariant> }) => request<EvalRun>("POST", "/engine/evals", input),
}
