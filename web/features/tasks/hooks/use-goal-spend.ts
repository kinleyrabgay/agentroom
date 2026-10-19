"use client"

import { useEffect, useState } from "react"
import { AgentEventType } from "@shared"
import { ledgerApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"

export interface GoalSpend {
  costUsd: number
  runs: number
}

/** Total cost and run count of a goal, from the run ledger. Re-fetched whenever one of its runs finishes. */
export function useGoalSpend(goalId: string): GoalSpend | null {
  // Changes each time a run belonging to this goal ends.
  const finishedRuns = useAppStore((s) => s.events.filter((e) => e.type === AgentEventType.RunDone && e.goalId === goalId).length)
  const [spend, setSpend] = useState<{ goalId: string; value: GoalSpend } | null>(null)

  useEffect(() => {
    let cancelled = false
    ledgerApi
      .list({ goalId })
      .then((rows) => {
        if (cancelled) return
        setSpend({ goalId, value: { costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0), runs: rows.length } })
      })
      .catch(() => {
        /* the line is optional; stay quiet */
      })
    return () => {
      cancelled = true
    }
  }, [goalId, finishedRuns])

  // Never show another goal's numbers while the new ones load.
  return spend?.goalId === goalId ? spend.value : null
}
