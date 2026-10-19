"use client"

import type { Goal } from "@shared"
import { OPTION_COLORS } from "../constants"
import type { ColumnView } from "../lib/board-view"
import { GithubCard } from "./github-card"

interface Props {
  view: ColumnView
  collapsed: boolean
  selected: Set<string>
  openId: string | null
  goalFor: (itemId: string) => Goal | undefined
  onToggle: (id: string, range: boolean) => void
  onOpen: (id: string) => void
}

/** One Status column. Empty columns can collapse to a slim strip. */
export function GithubColumn({ view, collapsed, selected, openId, goalFor, onToggle, onOpen }: Props) {
  const { column, items } = view
  const color = OPTION_COLORS[column.color ?? "GRAY"] ?? OPTION_COLORS.GRAY

  if (collapsed) {
    return (
      <div
        className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-dashed bg-sunken/50 py-3 text-xs text-muted-foreground"
        aria-label={`${column.name}, empty`}
      >
        <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
        <span className="[writing-mode:vertical-rl]">{column.name}</span>
      </div>
    )
  }

  return (
    <section className="flex w-[19rem] shrink-0 flex-col rounded-2xl bg-sunken/70" aria-label={`${column.name}, ${items.length} cards`}>
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2.5 text-sm">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className="truncate font-semibold">{column.name}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {items.length === 0 ? (
          <p className="grid h-16 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground">No cards</p>
        ) : (
          items.map((item) => (
            <GithubCard
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              selecting={selected.size > 0}
              open={openId === item.id}
              goal={goalFor(item.id)}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </section>
  )
}
