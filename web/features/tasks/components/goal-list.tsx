"use client"

import { useMemo, useState } from "react"
import { ListTodoIcon, SearchIcon } from "lucide-react"
import { GoalStatus, type Goal, type Task } from "@shared"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { ToneBadge } from "@/components/kit/badge"
import { GOAL_STATUS_META } from "../constants"
import { phaseIndex } from "../lib/goal-phase"
import { PhaseBar } from "./phase-stepper"

const WAITING = new Set<string>([GoalStatus.AwaitingApproval, GoalStatus.Paused, GoalStatus.Failed])

/** Goals, newest first, each with its status and progress; "Tasks without a goal" at the bottom. */
export function GoalList({
  goals,
  tasks,
  selected,
  looseCount,
  allKey,
  onSelect,
}: {
  goals: Goal[]
  tasks: Task[]
  selected: string
  looseCount: number
  allKey: string
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? goals.filter((g) => `${g.id} ${g.title} ${g.brief}`.toLowerCase().includes(q)) : goals
  }, [goals, query])
  const tasksOf = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) if (t.goalId) m.set(t.goalId, [...(m.get(t.goalId) ?? []), t])
    return m
  }, [tasks])

  return (
    <nav aria-label="Goals" className="flex h-full flex-col">
      <div className="relative p-3 pb-2">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a goal" aria-label="Find a goal" className="h-8 rounded-full pl-8" />
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {shown.map((g) => {
          const meta = GOAL_STATUS_META[g.status]
          const on = selected === g.id
          return (
            <li key={g.id}>
              <button
                onClick={() => onSelect(g.id)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  on ? "border-border bg-surface shadow-xs" : "border-transparent hover:bg-accent/60"
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{g.id}</span>
                  <ToneBadge tone={meta.tone} dot pulse={meta.live} size="sm" className="ml-auto">
                    {meta.label}
                  </ToneBadge>
                </span>
                <span className={cn("line-clamp-2 text-sm leading-snug", on && "font-medium")}>{g.title}</span>
                <PhaseBar current={phaseIndex(g, tasksOf.get(g.id) ?? [])} waiting={WAITING.has(g.status)} />
              </button>
            </li>
          )
        })}
        {!shown.length && (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            {goals.length ? "No goals match." : "No goals yet. Give the team one from the box below or New goal."}
          </li>
        )}
      </ul>
      <div className="border-t p-2">
        <button
          onClick={() => onSelect(allKey)}
          aria-current={selected === allKey ? "true" : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            selected === allKey ? "bg-surface font-medium shadow-xs" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          )}
        >
          <ListTodoIcon className="size-4" />
          Tasks without a goal
          {looseCount > 0 && <span className="ml-auto text-xs tabular-nums">{looseCount}</span>}
        </button>
      </div>
    </nav>
  )
}
