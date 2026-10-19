"use client"

import { ArrowRightIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Floating bar while items are selected on a page (GitHub cards, Sentry issues):
 * the count, Clear, and the one thing you do with a selection, Hand off.
 * Place inside a `relative` page container.
 */
export function SelectionBar({
  count,
  noun,
  onClear,
  onHandoff,
}: {
  count: number
  /** [singular, plural], e.g. ["card", "cards"]. */
  noun: [string, string]
  onClear: () => void
  onHandoff: () => void
}) {
  if (!count) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Selection"
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border bg-popover py-1.5 pr-1.5 pl-4 text-sm shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
      >
        <span className="font-semibold tabular-nums">{count}</span>
        <span className="text-muted-foreground">{count === 1 ? noun[0] : noun[1]} selected</span>
        <Button size="sm" variant="ghost" className="ml-1 rounded-full text-muted-foreground" onClick={onClear}>
          <XIcon data-icon="inline-start" /> Clear
        </Button>
        <Button size="sm" className="rounded-full" onClick={onHandoff}>
          Hand off <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
