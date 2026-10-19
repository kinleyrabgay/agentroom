"use client"

import { useState } from "react"
import { PlusIcon, XIcon } from "lucide-react"
import type { AcceptanceItem } from "@shared"
import { Checkbox } from "@/components/ui/checkbox"

/** Definition-of-done checklist: tick, edit inline, add, remove. */
export function AcceptanceEditor({
  items,
  onChange,
}: {
  items: AcceptanceItem[]
  onChange: (items: AcceptanceItem[]) => void
}) {
  const [draft, setDraft] = useState("")
  const set = (i: number, patch: Partial<AcceptanceItem>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))

  const add = () => {
    const text = draft.trim()
    if (!text) return
    onChange([...items, { text, done: false }])
    setDraft("")
  }

  return (
    <div className="space-y-1">
      {items.map((it, i) => (
        <div
          key={i}
          className="group flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/50"
        >
          <Checkbox
            checked={it.done}
            onCheckedChange={(v) => set(i, { done: v === true })}
            className="mt-0.5"
            aria-label="Done"
          />
          <textarea
            value={it.text}
            rows={1}
            onChange={(e) => set(i, { text: e.target.value })}
            className="field-sizing-content min-h-0 flex-1 resize-none bg-transparent text-sm leading-snug outline-none data-[done=true]:text-muted-foreground data-[done=true]:line-through"
            data-done={it.done}
          />
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="rounded-md text-muted-foreground/60 outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:text-muted-foreground"
            aria-label="Remove criterion"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 px-1.5 py-1">
        <PlusIcon className="size-4 text-muted-foreground" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          onBlur={add}
          placeholder="Add a criterion…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}
