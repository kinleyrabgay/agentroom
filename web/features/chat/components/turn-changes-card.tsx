"use client"

import { useState } from "react"
import { ChevronRightIcon, FileDiffIcon } from "lucide-react"
import type { TurnFileChange } from "@shared"
import { cn } from "@/lib/utils"
import { parseDiff, type DiffLine } from "@/features/tasks/lib/diff-lines"

const STATUS: Record<TurnFileChange["status"], string> = { added: "A", modified: "M", deleted: "D" }

/** "3 changed files +6 −2" under a reply: what the run wrote, each file opening to its diff. */
export function TurnChangesCard({ files, skipped }: { files: TurnFileChange[]; skipped: { path: string; reason: string }[] }) {
  const [open, setOpen] = useState(false)
  const add = files.reduce((n, f) => n + f.additions, 0)
  const del = files.reduce((n, f) => n + f.deletions, 0)

  return (
    <div className="rounded-xl border bg-sunken/60 text-xs">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
        <FileDiffIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium">
          {files.length} changed {files.length === 1 ? "file" : "files"}
        </span>
        <span className="tone-success tone-text tabular-nums">+{add}</span>
        <span className="tone-danger tone-text tabular-nums">−{del}</span>
        {skipped.length > 0 && <span className="text-muted-foreground">· {skipped.length} not tracked</span>}
        <ChevronRightIcon className={cn("ml-auto size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="space-y-1 border-t p-1.5">
          {files.map((f) => (
            <FileRow key={f.path} file={f} />
          ))}
          {skipped.map((s) => (
            <div key={s.path} className="flex gap-2 px-1.5 py-1 text-muted-foreground">
              <span className="font-mono">{s.path}</span>
              <span>· {s.reason}</span>
            </div>
          ))}
          <p className="px-1.5 pt-1 text-[11px] text-muted-foreground">Tracked from the bot&apos;s own edits; shell commands&apos; writes aren&apos;t listed.</p>
        </div>
      )}
    </div>
  )
}

function FileRow({ file: f }: { file: TurnFileChange }) {
  const [open, setOpen] = useState(false)
  const canOpen = !!f.patch
  return (
    <div className="rounded-lg">
      <button
        disabled={!canOpen}
        onClick={() => setOpen(!open)}
        aria-expanded={canOpen ? open : undefined}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left font-mono hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:hover:bg-transparent"
      >
        <span className="w-3 shrink-0 text-muted-foreground">{STATUS[f.status]}</span>
        <span className="truncate">{f.path}</span>
        <span className="ml-auto flex shrink-0 gap-1.5 tabular-nums">
          {f.note ? (
            <span className="font-sans text-muted-foreground">{f.note}</span>
          ) : (
            <>
              <span className="tone-success tone-text">+{f.additions}</span>
              <span className="tone-danger tone-text">−{f.deletions}</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <pre className="mt-1 max-h-80 overflow-auto rounded-lg border bg-surface py-1 font-mono text-[11px] leading-relaxed">
          {parseDiff(f.patch).map((l, i) =>
            l.kind === "hunk" ? (
              <div key={i} className="bg-muted/60 px-3 text-muted-foreground">{l.text}</div>
            ) : (
              <div key={i} className={cn("flex px-3", lineTone(l))}>
                <span className="w-4 shrink-0 select-none opacity-60">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
                <span className="whitespace-pre">{l.text}</span>
              </div>
            )
          )}
        </pre>
      )}
    </div>
  )
}

function lineTone(l: DiffLine) {
  if (l.kind === "add") return "tone-success bg-[color-mix(in_oklch,var(--tone)_10%,transparent)]"
  if (l.kind === "del") return "tone-danger bg-[color-mix(in_oklch,var(--tone)_10%,transparent)]"
  return ""
}
