"use client"

import { SearchIcon, XIcon } from "lucide-react"
import { FindingCategory, FindingSeverity, FindingStatus, type Goal } from "@shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dropdown } from "@/components/kit/dropdown"
import { ALL, CATEGORY_META, SEVERITY_META, STATUS_META } from "../constants"
import { DEFAULT_FILTERS, type FindingFilters } from "../lib/findings"

/** Search, then one row of filter pills (goal, severity, status, category). Changed pills are highlighted. */
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
  const changed =
    (showGoal && !!filters.goalId) || !!filters.severity || filters.status !== DEFAULT_FILTERS.status || !!filters.category || !!filters.search

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search findings, files, rules"
          className="h-8 rounded-full pl-9 text-[13px]"
          aria-label="Search findings"
        />
      </div>
      {showGoal && (
        <Dropdown<string>
          variant="pill"
          label="Goal"
          active={!!filters.goalId}
          hint="Find a goal"
          popoverWidth={300}
          datas={[{ label: "All goals", value: ALL }, ...goals.map((g) => ({ label: g.id, sublabel: g.title, value: g.id }))]}
          selectedValue={filters.goalId ?? ALL}
          onSelect={(v) => set({ goalId: pick(v as string) })}
        />
      )}
      <Dropdown<string>
        variant="pill"
        label="Severity"
        active={!!filters.severity}
        showSearch={false}
        datas={[{ label: "Any", value: ALL }, ...Object.values(FindingSeverity).map((s) => ({ label: SEVERITY_META[s].label, value: s }))]}
        selectedValue={filters.severity ?? ALL}
        onSelect={(v) => set({ severity: pick<FindingSeverity>(v as string) })}
      />
      <Dropdown<string>
        variant="pill"
        label="Status"
        active={filters.status !== DEFAULT_FILTERS.status}
        showSearch={false}
        datas={[{ label: "Any", value: ALL }, ...Object.values(FindingStatus).map((s) => ({ label: STATUS_META[s].label, value: s }))]}
        selectedValue={filters.status ?? ALL}
        onSelect={(v) => set({ status: pick<FindingStatus>(v as string) })}
      />
      <Dropdown<string>
        variant="pill"
        label="Category"
        active={!!filters.category}
        hint="Find a category"
        datas={[{ label: "Any", value: ALL }, ...Object.values(FindingCategory).map((c) => ({ label: CATEGORY_META[c].label, value: c }))]}
        selectedValue={filters.category ?? ALL}
        onSelect={(v) => set({ category: pick<FindingCategory>(v as string) })}
      />
      {changed && (
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onChange({ ...DEFAULT_FILTERS, goalId: showGoal ? null : filters.goalId })}>
          <XIcon data-icon="inline-start" /> Reset
        </Button>
      )}
    </div>
  )
}
