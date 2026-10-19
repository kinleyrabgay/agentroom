"use client"

import { XIcon } from "lucide-react"
import type { GithubItem } from "@shared"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { clearSelection, setGithub, useGithubStore } from "../lib/github-store"
import { itemRef } from "../lib/board-view"
import { HandoffForm } from "./handoff-form"
import { ItemTypeIcon } from "./item-type-icon"

const NO_ITEMS: GithubItem[] = []

/** Hand several selected cards to a bot at once (single cards are handed off from their details panel). */
export function HandoffDialog() {
  const open = useGithubStore((s) => s.handoffOpen)
  const selected = useGithubStore((s) => s.selected)
  // Select the board itself (a stable reference); a `?? []` inside the selector would create a new array
  // on every read and make React re-render forever.
  const board = useGithubStore((s) => s.board)
  const items = board?.items ?? NO_ITEMS
  const cards = items.filter((i) => selected.includes(i.id))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setGithub({ handoffOpen: false })}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Hand off {cards.length === 1 ? "card" : `${cards.length} cards`}</DialogTitle>
          <DialogDescription>Pick who takes them and add anything the team should know.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {cards.map((c) => (
            <span key={c.id} className="flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
              <ItemTypeIcon item={c} />
              <span className="font-mono text-muted-foreground">{itemRef(c)}</span>
              <span className="max-w-64 truncate">{c.title}</span>
              <button
                aria-label={`Remove ${itemRef(c)}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setGithub({ selected: selected.filter((id) => id !== c.id) })}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <HandoffForm
          cards={cards}
          autoFocus
          onDone={() => {
            clearSelection()
            setGithub({ handoffOpen: false })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
