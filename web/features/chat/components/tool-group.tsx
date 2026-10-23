"use client"

import { useState } from "react"
import { ChevronRightIcon, CircleCheckIcon, CircleXIcon, Loader2Icon, ShieldAlertIcon, SparklesIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { isActiveStep, ToolStepState, type ToolStep } from "../lib/transcript"
import { describeSteps, kindOf } from "../lib/tool-kinds"
import { InjectionBadge } from "@/features/security/components/injection-badge"

/** Collapsible "Read 3 files · Ran 2 commands" block; open and live while the bot is working through it. */
export function ToolGroup({ steps, live }: { steps: ToolStep[]; live: boolean }) {
  // Open while the bot works through it; once the user toggles, their choice wins.
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? live

  const active = steps.find(isActiveStep)
  const failed = steps.filter((s) => s.state === ToolStepState.Failed).length

  return (
    <div className="rounded-xl border bg-sunken/60">
      <button
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <GroupIcon active={active} />
        <span className="font-medium">{groupTitle(steps, active)}</span>
        {failed > 0 && <span className="tone-danger tone-text">· {failed} failed</span>}
        <ChevronRightIcon className={cn("ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <ol className="space-y-0.5 border-t px-2 py-1.5">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </ol>
      )}
    </div>
  )
}

const RAW_LIMIT = 4000

/** One tool call; opens to its raw input and output. */
function StepRow({ step: s }: { step: ToolStep }) {
  const [open, setOpen] = useState(false)
  const hasRaw = s.input !== undefined || !!s.output
  const input = s.input === undefined ? "" : typeof s.input === "string" ? s.input : JSON.stringify(s.input, null, 2)
  return (
    <li className="animate-in fade-in-0 slide-in-from-top-0.5">
      <button
        disabled={!hasRaw}
        onClick={() => setOpen(!open)}
        aria-expanded={hasRaw ? open : undefined}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left font-mono text-xs hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:hover:bg-transparent"
      >
        <StepIcon state={s.state} />
        <span className="shrink-0 font-medium text-foreground/90">{s.name}</span>
        <span className="truncate text-muted-foreground">{s.summary || (s.state === ToolStepState.Preparing ? "…" : "")}</span>
        {s.flagged && <InjectionBadge goalId={s.goalId} />}
      </button>
      {open && (
        <div className="mt-1 mb-1.5 ml-6 space-y-1.5">
          {input && <RawBlock label="Input" text={input} />}
          {s.output !== undefined && <RawBlock label="Output" text={s.output || "No output was returned."} />}
        </div>
      )}
    </li>
  )
}

function RawBlock({ label, text }: { label: string; text: string }) {
  const clipped = text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}\n… (${text.length - RAW_LIMIT} more chars)` : text
  return (
    <div>
      <div className="mb-0.5 text-[11px] text-muted-foreground">{label}</div>
      <pre className="max-h-56 overflow-auto rounded-md border bg-surface p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">{clipped}</pre>
    </div>
  )
}

/** A sentence: "Read 3 files · Ran 2 commands", or what's happening now ("Running npm test"). */
function groupTitle(steps: ToolStep[], active: ToolStep | undefined) {
  if (!active) return describeSteps(steps)
  if (active.state === ToolStepState.Waiting) return `Waiting for approval · ${active.name}`
  if (active.state === ToolStepState.Preparing) return `Preparing ${active.name}`
  return `${kindOf(active.name).active} ${active.summary || active.name}`
}

function GroupIcon({ active }: { active: ToolStep | undefined }) {
  if (!active) return <SparklesIcon className="size-3.5 text-muted-foreground" />
  if (active.state === ToolStepState.Waiting) return <ShieldAlertIcon className="tone-warning tone-text size-3.5" />
  return <Loader2Icon className="size-3.5 animate-spin text-brand" />
}

function StepIcon({ state }: { state: ToolStepState }) {
  switch (state) {
    case ToolStepState.Preparing:
    case ToolStepState.Running:
      return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />
    case ToolStepState.Waiting:
      return <ShieldAlertIcon className="tone-warning tone-text size-3.5 shrink-0" />
    case ToolStepState.Done:
      return <CircleCheckIcon className="tone-success tone-text size-3.5 shrink-0" />
    case ToolStepState.Failed:
      return <CircleXIcon className="tone-danger tone-text size-3.5 shrink-0" />
  }
}
