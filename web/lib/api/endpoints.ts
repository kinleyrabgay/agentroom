import type { AuditPage, AuditQuery, IntegrationSecrets, IntegrationStatus, LedgerEntry, Settings, SettingsPatch, AlertCapabilities, AlertPrefs, Bot, BotPatch, GithubBoard, GithubItem, GithubItemDetail, GithubProjectConfig, HandoffInput, HandoffResult, Config, EffortLevel, Goal, GoalPatch, NewTaskInput, ProjectInfo, ProviderModels, Skill, SkillInput, Task, TaskPatch } from "@shared"
import { request } from "./client"

const seg = encodeURIComponent

/** A bot patch where `null` clears model/effort (→ project default) or reportsTo (→ top of team). */
export type BotUpdate = Omit<BotPatch, "model" | "effort" | "reportsTo"> & {
  model?: string | null
  effort?: EffortLevel | null
  reportsTo?: string | null
}

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
  create: (brief: string, title?: string) => request<Goal>("POST", "/goals", { brief, title }),
  update: (id: string, patch: GoalPatch) => request<Goal>("PATCH", `/goals/${seg(id)}`, patch),
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
  update: (patch: SettingsPatch) => request<Settings>("PATCH", "/settings", patch),
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
