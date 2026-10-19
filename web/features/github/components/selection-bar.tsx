"use client"

import { ArrowRightIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { clearSelection, setGithub, useGithubStore } from "../lib/github-store"

/** Floating bar while cards are selected. */
export function SelectionBar() {
  const count = useGithubStore((s) => s.selected.length)
  if (!count) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover py-1.5 pr-1.5 pl-4 text-sm shadow-lg animate-in fade-in-0 slide-in-from-bottom-2">
        <span className="font-medium tabular-nums">{count}</span>
        <span className="text-muted-foreground">{count === 1 ? "card selected" : "cards selected"}</span>
        <Button size="xs" variant="ghost" onClick={clearSelection}>
          <XIcon data-icon="inline-start" /> Clear
        </Button>
        <Button size="sm" className="rounded-full" onClick={() => setGithub({ handoffOpen: true })}>
          Hand off <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
