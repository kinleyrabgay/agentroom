"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Markdown } from "@/components/shared/markdown"

/** Markdown description with Write / Preview modes. Opens in Preview when there's content. */
export function DescriptionEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [mode, setMode] = useState<"write" | "preview">(
    value ? "preview" : "write"
  )
  const tab = (m: typeof mode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={cn(
        "rounded-md px-2 py-0.5 text-xs",
        mode === m
          ? "bg-background font-medium shadow-xs"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="overflow-hidden rounded-2xl border">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-1.5 py-1">
        {tab("write", "Write")}
        {tab("preview", "Preview")}
        <span className="ml-auto pr-1 text-xs text-muted-foreground">
          Markdown
        </span>
      </div>
      {mode === "write" ? (
        <textarea
          value={value}
          autoFocus={!value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What to do, why, and any constraints…"
          className="block field-sizing-content min-h-36 w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
        />
      ) : (
        <div className="min-h-20 p-3" onDoubleClick={() => setMode("write")}>
          {value ? (
            <Markdown text={value} />
          ) : (
            <p className="text-xs text-muted-foreground">
              No description. Double-click to write one.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
