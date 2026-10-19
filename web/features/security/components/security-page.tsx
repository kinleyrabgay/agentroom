"use client"

import { useMemo, useState } from "react"
import { useAppStore } from "@/lib/store/app-store"
import { PageActions } from "@/components/layout/page-actions"
import { newestFirst } from "@/features/tasks/lib/goal-phase"
import { DEFAULT_FILTERS, filterFindings, type FindingFilters } from "../lib/findings"
import { useFindingCounts } from "../hooks/use-finding-counts"
import { FindingsFilters } from "./findings-filters"
import { FindingsList } from "./findings-list"
import { ScanButton } from "./scan-button"
import { StatTiles } from "./stat-tiles"

/** Governance → Security: every finding from the scanner, dependency guard, security reviews and injection guard. */
export function SecurityPage() {
  const findings = useAppStore((s) => s.findings)
  const goals = useAppStore((s) => s.goals)
  const initialGoal = useAppStore((s) => s.securityGoalId)
  // Opened from a goal or notification → start filtered to it; the user can widen it.
  const [filters, setFilters] = useState<FindingFilters>(() => ({ ...DEFAULT_FILTERS, goalId: initialGoal }))
  const counts = useFindingCounts(filters.goalId)
  const sortedGoals = useMemo(() => [...goals].sort(newestFirst), [goals])
  const visible = useMemo(() => filterFindings(findings, filters), [findings, filters])

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <PageActions>
        <ScanButton />
      </PageActions>
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-5 pb-24">
        <StatTiles counts={counts} />
        <FindingsFilters filters={filters} onChange={setFilters} goals={sortedGoals} />
        <FindingsList findings={visible} filters={filters} />
      </div>
    </div>
  )
}
