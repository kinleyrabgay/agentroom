"use client"

import { useState } from "react"
import { ChevronRightIcon, LayersIcon } from "lucide-react"
import type { SentryException, SentryFrame } from "@shared"
import { cn } from "@/lib/utils"
import { ToneBadge } from "@/components/kit/badge"

/** Exceptions with their frames, innermost first. In-app frames stand out; library frames fold away. */
export function StackTrace({ exceptions }: { exceptions: SentryException[] }) {
  // Sentry lists chained exceptions outermost-last; show the one that was thrown last on top.
  const list = [...exceptions].reverse()
  return (
    <div className="space-y-4">
      {list.map((ex, i) => (
        <ExceptionBlock key={i} ex={ex} chained={i > 0} />
      ))}
    </div>
  )
}

function ExceptionBlock({ ex, chained }: { ex: SentryException; chained: boolean }) {
  const frames = [...ex.frames].reverse()
  const hasInApp = frames.some((f) => f.inApp)
  const [showAll, setShowAll] = useState(!hasInApp)
  const hidden = frames.filter((f) => !f.inApp).length
  // The first in-app frame is where the app's code failed: open it by default.
  const firstInApp = frames.findIndex((f) => f.inApp)

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b bg-sunken/60 px-4 py-3">
        {chained && <p className="mb-0.5 text-xs font-medium text-muted-foreground">Caused by</p>}
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{ex.type}</span>
          {ex.handled === false && (
            <ToneBadge tone="danger" size="sm">
              Unhandled
            </ToneBadge>
          )}
          {ex.handled === true && (
            <ToneBadge tone="neutral" size="sm">
              Handled
            </ToneBadge>
          )}
        </p>
        {ex.value && <p className="mt-1 text-sm break-words text-foreground/80">{ex.value}</p>}
      </div>
      {frames.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No stack trace.</p>
      ) : (
        <ol className="divide-y">{frames.map((f, i) => (showAll || f.inApp ? <FrameRow key={i} frame={f} defaultOpen={i === firstInApp} /> : null))}</ol>
      )}
      {hasInApp && hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="flex w-full items-center gap-1.5 border-t px-4 py-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent"
        >
          <LayersIcon className="size-3.5" />
          {showAll ? "Hide library frames" : `Show ${hidden} library ${hidden === 1 ? "frame" : "frames"}`}
        </button>
      )}
    </div>
  )
}

function FrameRow({ frame: f, defaultOpen }: { frame: SentryFrame; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen && f.context.length > 0)
  const canOpen = f.context.length > 0
  return (
    <li className={cn(!f.inApp && "bg-sunken/40")}>
      <button
        type="button"
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-start gap-2 px-4 py-2 text-left font-mono text-xs outline-none focus-visible:bg-accent",
          canOpen && "hover:bg-accent"
        )}
      >
        <ChevronRightIcon className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90", !canOpen && "opacity-0")} />
        <span className={cn("min-w-0 break-all", f.inApp ? "text-foreground" : "text-muted-foreground")}>
          <span className={cn(f.inApp && "font-semibold")}>{f.filename || f.module || "?"}</span>
          {f.lineNo !== undefined && (
            <span>
              :{f.lineNo}
              {f.colNo !== undefined ? `:${f.colNo}` : ""}
            </span>
          )}
          {f.function && (
            <>
              <span className="text-muted-foreground"> in </span>
              <span>{f.function}</span>
            </>
          )}
        </span>
        {f.inApp && (
          <ToneBadge tone="brand" size="sm" className="ml-auto font-sans">
            App
          </ToneBadge>
        )}
      </button>
      {open && (
        <pre className="overflow-x-auto border-t bg-sunken/60 py-1.5 font-mono text-xs leading-5">
          {f.context.map(([line, code]) => (
            <div key={line} className={cn("flex px-4", line === f.lineNo && "tone-danger tone-soft border-y-0 font-medium")}>
              <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground select-none">{line}</span>
              <span className="whitespace-pre">{code}</span>
            </div>
          ))}
        </pre>
      )}
    </li>
  )
}
