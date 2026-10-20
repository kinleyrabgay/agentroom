"use client"

import { useMemo } from "react"
import type { Goal } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { isFinished } from "@/features/tasks/lib/goal-phase"

/** Active goals by the GitHub card, Sentry issue or Linear/Jira issue they came from. */
export function useGoalsBySource(type: "github" | "sentry" | "linear" | "jira"): Map<string, Goal> {
  const goals = useAppStore((s) => s.goals)
  return useMemo(() => {
    const map = new Map<string, Goal>()
    for (const g of goals) {
      if (isFinished(g.status)) continue
      for (const src of g.sources ?? []) if (src.type === type || (src.type === "issue" && src.tracker === type)) map.set(src.itemId, g)
    }
    return map
  }, [goals, type])
}
