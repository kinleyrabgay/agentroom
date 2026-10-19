"use client"

import { SearchIcon } from "lucide-react"
import { ActorType, AuditKind } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ACTOR_META, ALL, KIND_META } from "../lib/meta"
import type { AuditFilters } from "../hooks/use-audit-log"

export interface FilterState extends AuditFilters {
  actor?: ActorType
}

/** Search + kind / bot / goal / actor filters. */
export function AuditFilterBar({ value, onChange }: { value: FilterState; onChange: (v: FilterState) => void }) {
  const bots = useAppStore((s) => s.bots)
  const goals = useAppStore((s) => s.goals)
  const pick = <T extends string>(v: string) => (v === ALL ? undefined : (v as T))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          placeholder="Search commands, paths, summaries…"
          className="h-8 pl-8 text-sm"
          aria-label="Search the audit log"
        />
      </div>
      <Select value={value.kind ?? ALL} onValueChange={(v) => onChange({ ...value, kind: pick<AuditKind>(v) })}>
        <SelectTrigger size="sm" className="h-8 w-40" aria-label="Kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All kinds</SelectItem>
          {Object.values(AuditKind).map((k) => {
            const { label, icon: Icon } = KIND_META[k]
            return (
              <SelectItem key={k} value={k}>
                <Icon className="size-3.5" /> {label}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <Select value={value.botId ?? ALL} onValueChange={(v) => onChange({ ...value, botId: pick(v) })}>
        <SelectTrigger size="sm" className="h-8 w-36" aria-label="Bot">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All bots</SelectItem>
          {bots.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.avatar} {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={value.goalId ?? ALL} onValueChange={(v) => onChange({ ...value, goalId: pick(v) })}>
        <SelectTrigger size="sm" className="h-8 w-36" aria-label="Goal">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All goals</SelectItem>
          {[...goals].reverse().map((g) => (
            <SelectItem key={g.id} value={g.id}>
              <span className="font-mono text-xs">{g.id}</span> <span className="max-w-40 truncate">{g.title}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={value.actor ?? ALL} onValueChange={(v) => onChange({ ...value, actor: pick<ActorType>(v) })}>
        <SelectTrigger size="sm" className="h-8 w-36" aria-label="Decided by">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Anyone</SelectItem>
          {Object.values(ActorType).map((a) => {
            const { label, icon: Icon } = ACTOR_META[a]
            return (
              <SelectItem key={a} value={a}>
                <Icon className="size-3.5" /> {label}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
