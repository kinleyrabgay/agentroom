"use client"

import { ClockIcon } from "lucide-react"
import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { formatRelative } from "../lib/format"

/** Top-bar pill with the next scheduled run; opens Automation. Hidden when nothing is scheduled. */
export function NextRunPill() {
  const next = useAppStore((s) => s.automation?.next)
  const setView = useAppStore((s) => s.setView)
  if (!next) return null
  return (
    <button
      onClick={() => setView(View.Automation)}
      title={`Next: ${next.name}`}
      className="hidden h-8 items-center gap-1.5 rounded-full border bg-surface px-3 text-[13px] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 lg:inline-flex"
    >
      <ClockIcon className="size-3.5 text-brand" />
      Next: <span className="font-medium text-foreground">{formatRelative(next.at)}</span>
    </button>
  )
}
