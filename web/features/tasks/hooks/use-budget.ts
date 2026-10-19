"use client"

import { useEffect, useMemo, useState } from "react"
import { AgentEventType, type BudgetSummary } from "@shared"
import { budgetApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"

/** Shared across components: one request per change, not one per meter. */
let cache: BudgetSummary | null = null
let inflight: Promise<BudgetSummary> | null = null
let stamp = ""
const listeners = new Set<(b: BudgetSummary) => void>()

function load(key: string) {
  if (key === stamp && (cache || inflight)) return
  stamp = key
  inflight = budgetApi
    .summary()
    .then((b) => {
      cache = b
      listeners.forEach((l) => l(b))
      return b
    })
    .finally(() => {
      inflight = null
    })
  inflight.catch(() => {
    /* older server: no budgets; meters stay hidden */
  })
}

/** Today's spend and the caps (Settings → Budgets), refreshed whenever a run finishes or settings change. */
export function useBudget(): BudgetSummary | null {
  const finishedRuns = useAppStore((s) => s.events.filter((e) => e.type === AgentEventType.RunDone).length)
  const settings = useAppStore((s) => s.settings)
  const goals = useAppStore((s) => s.goals)
  const [value, setValue] = useState<BudgetSummary | null>(cache)

  useEffect(() => {
    listeners.add(setValue)
    return () => {
      listeners.delete(setValue)
    }
  }, [])

  // Refetch when a run ends, the caps change, or a goal's own budget changes.
  const key = useMemo(
    () => `${finishedRuns}|${JSON.stringify(settings?.budgets ?? null)}|${goals.map((g) => `${g.id}:${g.budgetUsd ?? ""}`).join(",")}`,
    [finishedRuns, settings, goals]
  )
  useEffect(() => {
    load(key)
  }, [key])

  return value
}

/** Tone for spend against a cap: warning past the warn line, danger at the cap. */
export function budgetTone(spent: number, cap: number | null, warnAt: number): "neutral" | "warning" | "danger" {
  if (cap === null) return "neutral"
  if (spent >= cap) return "danger"
  if (spent >= cap * warnAt) return "warning"
  return "neutral"
}
