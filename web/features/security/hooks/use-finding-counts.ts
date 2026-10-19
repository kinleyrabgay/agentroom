"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store/app-store"
import { countFindings } from "../lib/findings"

/** Finding counts across all goals, or for one goal. */
export function useFindingCounts(goalId?: string | null) {
  const findings = useAppStore((s) => s.findings)
  return useMemo(() => countFindings(findings, goalId), [findings, goalId])
}
