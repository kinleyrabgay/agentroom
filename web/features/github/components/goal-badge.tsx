"use client"

import { BotIcon } from "lucide-react"
import { GoalStatus, type Goal } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { ToneDot } from "@/components/kit/badge"
import type { Tone } from "@/components/kit/tone"
import { GOAL_STATUS_META } from "@/features/tasks/constants"

/** Goal status → tone: waiting on you is warning, running is brand, done is success. */
const GOAL_TONE: Partial<Record<GoalStatus, Tone>> = {
  [GoalStatus.AwaitingApproval]: "warning",
  [GoalStatus.Paused]: "warning",
  [GoalStatus.Done]: "success",
  [GoalStatus.Failed]: "danger",
  [GoalStatus.Cancelled]: "neutral",
}
const RUNNING = new Set<GoalStatus>([GoalStatus.Planning, GoalStatus.Building, GoalStatus.Securing, GoalStatus.Testing, GoalStatus.Verifying, GoalStatus.Reporting])

/** "G-3 · Building": the AgentRoom goal a card or issue was handed to. Opens it in Work. */
export function GoalBadge({ goal, className }: { goal: Goal; className?: string }) {
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const tone = GOAL_TONE[goal.status] ?? "brand"
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        showOnTasks({ goalId: goal.id })
      }}
      aria-label={`${goal.id}: ${GOAL_STATUS_META[goal.status].label}. Open in Work`}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border bg-surface px-2 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
        className
      )}
    >
      <BotIcon className="size-3.5 text-muted-foreground" />
      <span className="font-mono">{goal.id}</span>
      <ToneDot tone={tone} pulse={RUNNING.has(goal.status)} />
      <span className="text-muted-foreground">{GOAL_STATUS_META[goal.status].label}</span>
    </button>
  )
}
