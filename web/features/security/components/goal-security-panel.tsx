"use client"

import { useMemo, useState } from "react"
import { useAppStore } from "@/lib/store/app-store"
import { DEFAULT_FILTERS, filterFindings, type FindingFilters } from "../lib/findings"
import { useFindingCounts } from "../hooks/use-finding-counts"
import { FindingsFilters } from "./findings-filters"
import { FindingsList } from "./findings-list"
import { ScanButton } from "./scan-button"
import { StatTiles } from "./stat-tiles"

/** A goal's Security tab: its findings only, plus "Scan this goal". */
export function GoalSecurityPanel({ goalId }: { goalId: string }) {
  const findings = useAppStore((s) => s.findings)
  const goals = useAppStore((s) => s.goals)
  const [filters, setFilters] = useState<FindingFilters>(DEFAULT_FILTERS)
  const scoped = useMemo(() => ({ ...filters, goalId }), [filters, goalId])
  const visible = useMemo(() => filterFindings(findings, scoped), [findings, scoped])
  const counts = useFindingCounts(goalId)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <FindingsFilters filters={filters} onChange={setFilters} goals={goals} showGoal={false} />
        </div>
        <ScanButton goalId={goalId} />
      </div>
      <StatTiles counts={counts} />
      <FindingsList findings={visible} filters={scoped} showGoal={false} />
    </div>
  )
}
