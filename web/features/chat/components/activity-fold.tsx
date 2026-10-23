"use client"

import { useEffect, useState } from "react"
import { ChevronRightIcon, Loader2Icon, ShieldAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Markdown } from "@/components/shared/markdown"
import { ToolStepState, type TranscriptItem } from "../lib/transcript"
import { ToolGroup } from "./tool-group"
import { useFinding } from "./thread-find"

type Activity = Extract<TranscriptItem, { kind: "activity" }>

/** "12s", "2m 10s", "1h 4m". */
export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Seconds since `from`, ticking once a second while `on` and the tab is visible. */
function useElapsed(from: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [on])
  return from ? now - from : 0
}

/**
 * A turn's narration and tool calls behind one row: "Worked for 2m 10s ›". While the bot works it
 * stays open with a live label ("Waiting for approval · 12s"); once done it folds, unless you opened it.
 */
export function ActivityFold({ item }: { item: Activity }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  // A search opens every fold so its text can be found and highlighted.
  const finding = useFinding()
  const open = finding || (userOpen ?? item.live)
  const elapsed = useElapsed(item.startedAt, item.live)
  const waiting = item.items.some((it) => it.kind === "tools" && it.steps.some((s) => s.state === ToolStepState.Waiting))

  let label: string
  if (item.live) label = `${waiting ? "Waiting for approval" : "Working"}${item.startedAt ? ` · ${formatElapsed(elapsed)}` : ""}`
  else if (item.startedAt && item.endedAt) label = `Worked for ${formatElapsed(item.endedAt - item.startedAt)}`
  else label = "Worked"

  return (
    <div data-turn-key={item.key}>
      <button
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        {item.live && (waiting ? <ShieldAlertIcon className="tone-warning tone-text size-3.5" /> : <Loader2Icon className="size-3.5 animate-spin text-brand" />)}
        <span className="tabular-nums">{label}</span>
        <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-2 border-l-2 pl-3">
          {item.items.map((it) =>
            it.kind === "tools" ? (
              <ToolGroup key={it.key} steps={it.steps} live={it.live} />
            ) : it.kind === "text" ? (
              <div key={it.key} className={cn("text-sm text-muted-foreground", it.live && "streaming")}>
                <Markdown text={it.text} />
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  )
}
