"use client"

import { ShieldCheckIcon } from "lucide-react"
import { FindingStatus, type SecurityFinding } from "@shared"
import { useNow } from "@/hooks/use-now"
import { EmptyState } from "@/components/kit/state-view"
import type { FindingFilters } from "../lib/findings"
import { FindingCard } from "./finding-card"

/** Finding cards, or a reassuring empty state. */
export function FindingsList({ findings, filters, showGoal = true }: { findings: SecurityFinding[]; filters: FindingFilters; showGoal?: boolean }) {
  const now = useNow()
  if (!findings.length) {
    const openOnly = filters.status === FindingStatus.Open && !filters.search && !filters.severity && !filters.category
    return (
      <EmptyState
        icon={ShieldCheckIcon}
        title={openOnly ? "No open security findings" : "Nothing matches these filters"}
        description={
          openOnly
            ? "The scanner checks every task's changes and every commit, push and PR. Anything it finds shows up here."
            : "Try another status or clear the search."
        }
        className="rounded-xl border border-dashed py-12"
      />
    )
  }
  return (
    <ul className="space-y-2">
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} now={now} showGoal={showGoal} />
      ))}
    </ul>
  )
}
