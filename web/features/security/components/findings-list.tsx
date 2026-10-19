"use client"

import { ShieldCheckIcon } from "lucide-react"
import { FindingStatus, type SecurityFinding } from "@shared"
import { useNow } from "@/hooks/use-now"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { FindingFilters } from "../lib/findings"
import { FindingCard } from "./finding-card"

/** Finding cards, or a reassuring empty state. */
export function FindingsList({ findings, filters, showGoal = true }: { findings: SecurityFinding[]; filters: FindingFilters; showGoal?: boolean }) {
  const now = useNow()
  if (!findings.length) {
    const openOnly = filters.status === FindingStatus.Open && !filters.search && !filters.severity && !filters.category
    return (
      <Empty className="rounded-xl border border-dashed py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheckIcon className="text-emerald-500" />
          </EmptyMedia>
          <EmptyTitle>{openOnly ? "No open security findings" : "Nothing matches these filters"}</EmptyTitle>
          <EmptyDescription>
            {openOnly
              ? "The scanner checks every task's changes and every commit, push and PR. Anything it finds shows up here."
              : "Try another status or clear the search."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
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
