"use client"

import { XIcon } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HandoffForm, type HandoffFormProps } from "./handoff-form"

export interface HandoffChip {
  id: string
  /** Small leading mark (type icon, level dot). */
  icon?: React.ReactNode
  /** Short reference, e.g. "#4503" or "WEB-4X". */
  ref: string
  title: string
}

/**
 * Hand several selected items to a bot at once. One item is handed off from its Inspector instead.
 * The chips can be removed from the selection before sending.
 */
export function HandoffDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  onRemove,
  form,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  items: HandoffChip[]
  onRemove: (id: string) => void
  form: Omit<HandoffFormProps, "count" | "autoFocus">
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" aria-label="Selected">
          {items.map((i) => (
            <li key={i.id} className="flex max-w-full items-center gap-1.5 rounded-full border bg-sunken py-1 pr-1 pl-2.5 text-xs">
              {i.icon}
              <span className="font-mono text-muted-foreground">{i.ref}</span>
              <span className="max-w-60 truncate">{i.title}</span>
              <button
                type="button"
                aria-label={`Remove ${i.ref}`}
                className="grid size-5 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                onClick={() => onRemove(i.id)}
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
        <HandoffForm {...form} count={items.length} autoFocus />
      </DialogContent>
    </Dialog>
  )
}
