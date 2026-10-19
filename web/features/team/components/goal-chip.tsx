"use client"

import { useMemo } from "react"
import { RocketIcon } from "lucide-react"
import { GoalStatus, TaskStatus } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { GOAL_STATUS_META } from "@/features/tasks/constants"
import { isFinished, newestFirst } from "@/features/tasks/lib/goal-phase"

/** The goal the team is on right now (newest unfinished), shown on the lead's card. Click → Tasks. */
export function GoalChip() {
  const goals = useAppStore((s) => s.goals)
  const tasks = useAppStore((s) => s.tasks)
  const showOnTasks = useAppStore((s) => s.showOnTasks)

  const goal = useMemo(
    () => [...goals].sort(newestFirst).find((g) => !isFinished(g.status)),
    [goals]
  )
  if (!goal) return null

  const own = tasks.filter((t) => t.goalId === goal.id)
  const done = own.filter((t) => t.status === TaskStatus.Done).length
  const meta = GOAL_STATUS_META[goal.status]

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        showOnTasks({ goalId: goal.id })
      }}
      title={`${goal.title} — open in Tasks`}
      className={cn(
        "mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] hover:bg-muted",
        goal.status === GoalStatus.AwaitingApproval
          ? "border-amber-500/40 bg-amber-500/10"
          : "bg-muted/40"
      )}
    >
      <RocketIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="font-mono text-[10px] text-muted-foreground">
        {goal.id}
      </span>
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
      <span className="font-medium">{meta.label}</span>
      {own.length > 0 && (
        <span className="ml-auto text-muted-foreground tabular-nums">
          {done}/{own.length}
        </span>
      )}
    </button>
  )
}
