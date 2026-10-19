"use client"

import { BotIcon } from "lucide-react"
import type { Goal } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { GOAL_STATUS_META } from "@/features/tasks/constants"
import { cn } from "@/lib/utils"

/** "G-3 · Building": the AgentRoom goal this card was handed to. Opens it in Tasks. */
export function GoalBadge({ goal, className }: { goal: Goal; className?: string }) {
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const meta = GOAL_STATUS_META[goal.status]
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        showOnTasks({ goalId: goal.id })
      }}
      className={cn("inline-flex items-center gap-1 rounded-full border bg-background px-1.5 py-px text-[10px] font-medium hover:bg-muted", className)}
      title={`Open ${goal.id} in Tasks`}
    >
      <BotIcon className="size-3 text-muted-foreground" />
      <span className="font-mono">{goal.id}</span>
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </button>
  )
}
