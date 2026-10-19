"use client"

import { SearchIcon, XIcon } from "lucide-react"
import { ActorType, AuditKind } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dropdown } from "@/components/kit/dropdown"
import { DateTimePicker } from "@/components/kit/date-time-picker"
import { ACTOR_META, ALL, KIND_META } from "../lib/meta"
import type { AuditFilters } from "../hooks/use-audit-log"

export interface FilterState extends AuditFilters {
  actor?: ActorType
}

/** Search, then filter pills (kind, bot, goal, who decided) and a date to jump back to. */
export function AuditFilterBar({ value, onChange }: { value: FilterState; onChange: (v: FilterState) => void }) {
  const bots = useAppStore((s) => s.bots)
  const goals = useAppStore((s) => s.goals)
  const pick = <T extends string>(v: string) => (v === ALL ? undefined : (v as T))
  const changed = !!(value.kind || value.botId || value.goalId || value.actor || value.before)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          placeholder="Search commands, paths, summaries…"
          className="h-8 rounded-full pl-9 text-[13px]"
          aria-label="Search the audit log"
        />
      </div>
      <Dropdown<string>
        variant="pill"
        label="Kind"
        active={!!value.kind}
        hint="Find a kind"
        datas={[{ label: "All", value: ALL }, ...Object.values(AuditKind).map((k) => ({ label: KIND_META[k].label, value: k }))]}
        selectedValue={value.kind ?? ALL}
        onSelect={(v) => onChange({ ...value, kind: pick<AuditKind>(v as string) })}
      />
      <Dropdown<string>
        variant="pill"
        label="Bot"
        active={!!value.botId}
        hint="Find a bot"
        datas={[{ label: "All", value: ALL }, ...bots.map((b) => ({ label: b.name, sublabel: b.role, value: b.id }))]}
        selectedValue={value.botId ?? ALL}
        onSelect={(v) => onChange({ ...value, botId: pick(v as string) })}
      />
      <Dropdown<string>
        variant="pill"
        label="Goal"
        active={!!value.goalId}
        hint="Find a goal"
        popoverWidth={300}
        datas={[{ label: "All", value: ALL }, ...[...goals].reverse().map((g) => ({ label: g.id, sublabel: g.title, value: g.id }))]}
        selectedValue={value.goalId ?? ALL}
        onSelect={(v) => onChange({ ...value, goalId: pick(v as string) })}
      />
      <Dropdown<string>
        variant="pill"
        label="Decided by"
        active={!!value.actor}
        showSearch={false}
        datas={[{ label: "Anyone", value: ALL }, ...Object.values(ActorType).map((a) => ({ label: ACTOR_META[a].label, value: a }))]}
        selectedValue={value.actor ?? ALL}
        onSelect={(v) => onChange({ ...value, actor: pick<ActorType>(v as string) })}
      />
      <div className="w-56" aria-label="Show entries before">
        <DateTimePicker
          value={value.before ? new Date(value.before) : undefined}
          onChange={(d) => onChange({ ...value, before: d.toISOString() })}
          placeholder="Jump to date…"
        />
      </div>
      {changed && (
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onChange({ q: value.q })}>
          <XIcon data-icon="inline-start" /> Reset
        </Button>
      )}
    </div>
  )
}
