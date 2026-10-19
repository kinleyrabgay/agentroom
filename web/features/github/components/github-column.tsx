"use client"

import { ChevronRightIcon } from "lucide-react"
import type { Goal } from "@shared"
import { cn } from "@/lib/utils"
import { OPTION_COLORS } from "../constants"
import type { ColumnView } from "../lib/board-view"
import { GithubCard } from "./github-card"

interface Props {
  view: ColumnView
  collapsed: boolean
  selected: Set<string>
  goalFor: (itemId: string) => Goal | undefined
  onToggle: (id: string, range: boolean) => void
  onOpen: (id: string) => void
}

/** One Status column. Empty columns can collapse to a slim strip. */
export function GithubColumn({ view, collapsed, selected, goalFor, onToggle, onOpen }: Props) {
  const { column, items } = view
  const color = OPTION_COLORS[column.color ?? "GRAY"] ?? OPTION_COLORS.GRAY

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/20 py-3 text-xs text-muted-foreground" title={`${column.name} (empty)`}>
        <span className="size-2 rounded-full" style={{ background: color }} />
        <span className="[writing-mode:vertical-rl]">{column.name}</span>
      </div>
    )
  }

  return (
    <section className="flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/30" aria-label={column.name}>
      <header className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium">
        <span className="size-2.5 rounded-full" style={{ background: color }} />
        <span className="truncate">{column.name}</span>
        <span className="ml-auto rounded-full bg-background px-2 text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {items.length === 0 ? (
          <div className={cn("grid h-16 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground")}>
            <span className="flex items-center gap-1">
              <ChevronRightIcon className="size-3" /> Nothing here
            </span>
          </div>
        ) : (
          items.map((item) => (
            <GithubCard key={item.id} item={item} selected={selected.has(item.id)} goal={goalFor(item.id)} onToggle={onToggle} onOpen={onOpen} />
          ))
        )}
      </div>
    </section>
  )
}
