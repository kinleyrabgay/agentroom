import { GoalStatus, SecurityReviewMode, TaskKind, TaskStatus, type Goal, type Task } from "@shared"

/**
 * Fill in defaults for tasks and goals sent by an older AgentRoom server (e.g. one started before an
 * update), so the UI never crashes on a missing field. The current server already sends complete data.
 */
export function normalizeTask(t: Partial<Task> & { id: string; title: string }): Task {
  const now = new Date().toISOString()
  return {
    kind: TaskKind.Dev,
    status: TaskStatus.Todo,
    order: 0,
    description: "",
    acceptance: [],
    files: [],
    dependsOn: [],
    notes: "",
    log: [],
    commits: [],
    createdBy: "human",
    createdAt: now,
    updatedAt: now,
    ...t,
  }
}

export function normalizeGoal(g: Partial<Goal> & { id: string }): Goal {
  const now = new Date().toISOString()
  return {
    title: g.id,
    brief: "",
    status: GoalStatus.Paused,
    plan: "",
    summary: "",
    round: 0,
    sources: [],
    attachments: [],
    reviewComments: [],
    securityReview: SecurityReviewMode.Auto,
    createdAt: now,
    updatedAt: now,
    ...g,
  } as Goal
}

export const normalizeTasks = (list: unknown): Task[] =>
  Array.isArray(list) ? list.filter((t) => t && typeof t === "object" && "id" in t).map((t) => normalizeTask(t as Task)) : []

export const normalizeGoals = (list: unknown): Goal[] =>
  Array.isArray(list) ? list.filter((g) => g && typeof g === "object" && "id" in g).map((g) => normalizeGoal(g as Goal)) : []
