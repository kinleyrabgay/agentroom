import { GoalStatus, TaskStatus, type Goal, type Task } from "@shared"

const PHASE_OF: Partial<Record<GoalStatus, number>> = {
  [GoalStatus.Planning]: 0,
  [GoalStatus.AwaitingApproval]: 1,
  [GoalStatus.Building]: 2,
  [GoalStatus.Securing]: 3,
  [GoalStatus.Testing]: 4,
  [GoalStatus.Verifying]: 5,
  [GoalStatus.Reporting]: 6,
  [GoalStatus.Done]: 7,
}

/** Index into PHASES for a goal. Paused/failed/cancelled goals stay on the step where they stopped. */
export function phaseIndex(goal: Goal, tasks: Task[]): number {
  const direct = PHASE_OF[goal.status]
  if (direct !== undefined) return direct
  // Held at the quality gate, or proof failed: the goal stopped in Verify.
  if (goal.reason?.startsWith("Quality gate") || goal.reason?.startsWith("Proof failed")) return PHASE_OF[GoalStatus.Verifying]!
  // Infer where a stopped goal got to from its tasks.
  if (!tasks.length) return 0
  if (tasks.every((t) => t.status === TaskStatus.Done)) return 6
  if (tasks.some((t) => t.status !== TaskStatus.Todo)) return 2
  return 1
}

export const isRunning = (s: GoalStatus) =>
  s === GoalStatus.Planning ||
  s === GoalStatus.Building ||
  s === GoalStatus.Securing ||
  s === GoalStatus.Testing ||
  s === GoalStatus.Verifying ||
  s === GoalStatus.Reporting

export const isFinished = (s: GoalStatus) =>
  s === GoalStatus.Done || s === GoalStatus.Failed || s === GoalStatus.Cancelled

export const byOrder = (a: Task, b: Task) =>
  a.order - b.order || a.id.localeCompare(b.id, undefined, { numeric: true })

/** Newest goal first (ids are G-n). */
export const newestFirst = (a: Goal, b: Goal) =>
  b.createdAt.localeCompare(a.createdAt)

export function goalProgress(tasks: Task[]) {
  const done = tasks.filter((t) => t.status === TaskStatus.Done).length
  return { done, total: tasks.length }
}
