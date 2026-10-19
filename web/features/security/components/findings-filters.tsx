"use client"

import { SearchIcon } from "lucide-react"
import { FindingCategory, FindingSeverity, FindingStatus, type Goal } from "@shared"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ALL, CATEGORY_META, SEVERITY_META, STATUS_META } from "../constants"
import type { FindingFilters } from "../lib/findings"

/** Filter bar: goal, severity, status, category, search. */
export function FindingsFilters({
  filters,
  onChange,
  goals,
  showGoal = true,
}: {
  filters: FindingFilters
  onChange: (f: FindingFilters) => void
  goals: Goal[]
  showGoal?: boolean
}) {
  const set = (patch: Partial<FindingFilters>) => onChange({ ...filters, ...patch })
  const pick = <T extends string>(v: string) => (v === ALL ? null : (v as T))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search findings, files, rules"
          className="h-8 pl-8 text-sm"
          aria-label="Search findings"
        />
      </div>
      {showGoal && (
        <Select value={filters.goalId ?? ALL} onValueChange={(v) => set({ goalId: pick(v) })}>
          <SelectTrigger size="sm" className="w-40" aria-label="Goal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All goals</SelectItem>
            {goals.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                <span className="font-mono text-xs">{g.id}</span> <span className="truncate">{g.title}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={filters.severity ?? ALL} onValueChange={(v) => set({ severity: pick<FindingSeverity>(v) })}>
        <SelectTrigger size="sm" className="w-36" aria-label="Severity">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any severity</SelectItem>
          {Object.values(FindingSeverity).map((s) => {
            const Icon = SEVERITY_META[s].icon
            return (
              <SelectItem key={s} value={s}>
                <Icon className={SEVERITY_META[s].text} /> {SEVERITY_META[s].label}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <Select value={filters.status ?? ALL} onValueChange={(v) => set({ status: pick<FindingStatus>(v) })}>
        <SelectTrigger size="sm" className="w-36" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any status</SelectItem>
          {Object.values(FindingStatus).map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_META[s].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.category ?? ALL} onValueChange={(v) => set({ category: pick(v) })}>
        <SelectTrigger size="sm" className="w-44" aria-label="Category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any category</SelectItem>
          {Object.values(FindingCategory).map((c) => {
            const Icon = CATEGORY_META[c].icon
            return (
              <SelectItem key={c} value={c}>
                <Icon /> {CATEGORY_META[c].label}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
