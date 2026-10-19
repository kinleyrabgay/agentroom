"use client"

import { CheckIcon, CircleAlertIcon, Loader2Icon } from "lucide-react"
import { cn } from "@/lib/utils"

export type SaveState = "idle" | "saving" | "saved" | "error"

/** "Saving…" / "Saved" / "Not saved" for forms that save as you type. */
export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  if (state === "idle") return null
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)} aria-live="polite">
      {state === "saving" && (
        <>
          <Loader2Icon className="size-3.5 animate-spin" /> Saving…
        </>
      )}
      {state === "saved" && (
        <>
          <CheckIcon className="tone-success tone-text size-3.5" /> Saved
        </>
      )}
      {state === "error" && (
        <span className="tone-danger tone-text inline-flex items-center gap-1">
          <CircleAlertIcon className="size-3.5" /> Not saved
        </span>
      )}
    </span>
  )
}
