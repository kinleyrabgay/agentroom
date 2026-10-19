"use client"

import { useState } from "react"
import { ListTodoIcon, PlusIcon } from "lucide-react"
import type { Goal } from "@shared"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { GOAL_STATUS_META } from "../constants"
import { NewGoalDialog } from "./new-goal-dialog"

/** Horizontal goal switcher: newest goal first, plus the standalone tasks bucket. */
export function GoalBar({
  goals,
  selected,
  looseCount,
  onSelect,
  allKey,
}: {
  goals: Goal[]
  selected: string
  looseCount: number
  onSelect: (id: string) => void
  allKey: string
}) {
  const [creating, setCreating] = useState(false)
  const pill =
    "flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-sm transition-colors"

  return (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto pb-0.5">
        {goals.map((g) => {
          const meta = GOAL_STATUS_META[g.status]
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              title={`${g.title} — ${meta.label}`}
              className={cn(
                pill,
                selected === g.id
                  ? "border-foreground/20 bg-muted font-medium"
                  : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
              <span className="font-mono text-[11px] text-muted-foreground">
                {g.id}
              </span>
              <span className="max-w-48 truncate">{g.title}</span>
            </button>
          )
        })}
        <button
          onClick={() => onSelect(allKey)}
          className={cn(
            pill,
            selected === allKey
              ? "border-foreground/20 bg-muted font-medium"
              : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          <ListTodoIcon className="size-3.5" />
          Other tasks
          {looseCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {looseCount}
            </span>
          )}
        </button>
      </div>
      <Button size="sm" onClick={() => setCreating(true)}>
        <PlusIcon data-icon="inline-start" /> New goal
      </Button>
      <NewGoalDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
