"use client"

import { useMemo, useState } from "react"
import { useAppStore } from "@/lib/store/app-store"
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
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">
              Secrets, risky code, vulnerable dependencies and prompt injection found in the bots&apos; changes. Critical findings block commits and PRs until you decide.
            </p>
          </div>
          <ScanButton />
        </div>
        <StatTiles counts={counts} />
        <FindingsFilters filters={filters} onChange={setFilters} goals={sortedGoals} />
        <FindingsList findings={visible} filters={filters} />
      </div>
    </div>
  )
}
