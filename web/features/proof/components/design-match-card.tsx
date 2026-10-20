"use client"

import { useState } from "react"
import { PaletteIcon } from "lucide-react"
import type { DesignMatch, ProofCheck } from "@shared"
import { cn } from "@/lib/utils"
import { Callout } from "@/components/kit/callout"
import { ToneBadge } from "@/components/kit/badge"
import { Segmented } from "@/components/kit/segmented"
import { TONE_CLASS, type Tone } from "@/components/kit/tone"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { proofFileUrl } from "../lib/proof-url"

type Mode = "side" | "diff"

/** Implement design goals: the design next to the implemented page, the differences and the match score. */
export function DesignMatchCard({ goalId, match, check, version }: { goalId: string; match: DesignMatch; check?: ProofCheck; version: string }) {
  const [mode, setMode] = useState<Mode>("side")
  const [open, setOpen] = useState<{ src: string; label: string } | null>(null)
  const url = (file: string) => proofFileUrl(goalId, file, version)
  const tone: Tone = check?.status === "fail" ? "danger" : check?.status === "pass" ? "success" : "neutral"

  return (
    <section aria-label="Design match" className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <PaletteIcon className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">Design match</h3>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {match.path}
          {match.width ? ` · ${match.width}×${match.height}` : ""}
        </span>
        {!match.error && (
          <ToneBadge tone={tone} size="sm">
            {match.score}/100{check?.threshold !== undefined ? ` · needs ${check.threshold}` : ""}
          </ToneBadge>
        )}
        {!match.error && (
          <div className="ml-auto">
            <Segmented<Mode>
              size="sm"
              aria-label="Design view"
              value={mode}
              onChange={setMode}
              options={[
                { value: "side", label: "Side by side" },
                ...(match.diff ? [{ value: "diff" as const, label: "Differences" }] : []),
              ]}
            />
          </div>
        )}
      </header>

      {match.error ? (
        <div className="p-4">
          <Callout tone="info" title="Couldn't compare with the design">
            {match.error}
          </Callout>
        </div>
      ) : (
        <>
          <div className="bg-sunken/50 p-4">
            {mode === "side" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Pane label={match.source === "figma" ? "Figma frame" : "Design"} src={url(match.reference)} onOpen={setOpen} />
                <Pane label="Implementation" src={url(match.shot)} onOpen={setOpen} />
              </div>
            ) : (
              match.diff && <Pane label="Differences (red)" src={url(match.diff)} onOpen={setOpen} />
            )}
          </div>
          <dl className="grid grid-cols-3 divide-x border-t">
            <Metric label="Structure" value={match.structure} />
            <Metric label="Pixels" value={match.pixelMatch} />
            <Metric label="Proportions" value={match.proportions} />
          </dl>
        </>
      )}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{open?.label}</DialogTitle>
            <DialogDescription>
              {match.path} at {match.width}×{match.height}
            </DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {open && <img src={open.src} alt={open.label} className="max-h-[75vh] w-full rounded-lg border object-contain" />}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function Pane({ label, src, onOpen }: { label: string; src: string; onOpen: (v: { src: string; label: string }) => void }) {
  return (
    <button
      onClick={() => onOpen({ src, label })}
      className="group block w-full overflow-hidden rounded-lg border bg-background text-left shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} loading="lazy" className="max-h-[50vh] w-full object-contain object-top transition-opacity group-hover:opacity-90" />
      <span className="block border-t px-2.5 py-1.5 text-xs text-muted-foreground">{label}</span>
    </button>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  const tone: Tone = value >= 80 ? "success" : value >= 60 ? "warning" : "danger"
  return (
    <div className="px-4 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-center gap-2">
        <span className="text-sm font-medium tabular-nums">{Math.round(value)}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className={cn(TONE_CLASS[tone], "tone-solid block h-full rounded-full")} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
        </span>
      </dd>
    </div>
  )
}
