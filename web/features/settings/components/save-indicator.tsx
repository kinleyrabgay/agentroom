"use client"

import { CheckIcon, Loader2Icon } from "lucide-react"
import { SaveStatus } from "../hooks/use-settings-section"

/** "Saving…" / "Saved" next to a section title. */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === SaveStatus.Idle) return null
  return (
    <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground" aria-live="polite">
      {status === SaveStatus.Saving ? (
        <>
          <Loader2Icon className="size-3 animate-spin" /> Saving…
        </>
      ) : (
        <>
          <CheckIcon className="size-3 text-emerald-500" /> Saved
        </>
      )}
    </span>
  )
}
