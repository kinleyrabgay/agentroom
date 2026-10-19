"use client"

import { useState } from "react"
import { ChevronRightIcon, CircleCheckIcon, CircleXIcon, Loader2Icon, ShieldAlertIcon, SparklesIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { isActiveStep, ToolStepState, type ToolStep } from "../lib/transcript"
import { InjectionBadge } from "@/features/security/components/injection-badge"

/** Collapsible "Used N tools" block; open and live while the bot is working through it. */
export function ToolGroup({ steps, live }: { steps: ToolStep[]; live: boolean }) {
  // Open while the bot works through it; once the user toggles, their choice wins.
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? live

  const active = steps.find(isActiveStep)
  const failed = steps.filter((s) => s.state === ToolStepState.Failed).length
  const names = [...new Set(steps.map((s) => s.name))]

  return (
    <div className="rounded-xl border bg-sunken/60">
      <button
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <GroupIcon active={active} />
        <span className="font-medium">{groupTitle(steps, active)}</span>
        {!open && <span className="truncate text-muted-foreground">{names.join(", ")}</span>}
        {failed > 0 && <span className="tone-danger tone-text">· {failed} failed</span>}
        <ChevronRightIcon className={cn("ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <ol className="space-y-0.5 border-t px-2 py-1.5">
          {steps.map((s) => (
            <li key={s.id} className="flex animate-in items-center gap-2 rounded-md px-1.5 py-1 font-mono text-xs fade-in-0 slide-in-from-top-0.5">
              <StepIcon state={s.state} />
              <span className="shrink-0 font-medium text-foreground/90">{s.name}</span>
              <span className="truncate text-muted-foreground">{s.summary || (s.state === ToolStepState.Preparing ? "…" : "")}</span>
              {s.flagged && <InjectionBadge goalId={s.goalId} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function groupTitle(steps: ToolStep[], active: ToolStep | undefined) {
  if (!active) return `Used ${steps.length} ${steps.length === 1 ? "tool" : "tools"}`
  if (active.state === ToolStepState.Waiting) return `Waiting for approval · ${active.name}`
  return `${active.state === ToolStepState.Preparing ? "Preparing" : "Running"} ${active.name}`
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
