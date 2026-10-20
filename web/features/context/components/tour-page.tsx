"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FileCodeIcon, MapIcon, MessageSquareTextIcon, RotateCcwIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import type { ContextTour, ContextTourStep } from "@shared"
import { cn } from "@/lib/utils"
import { contextApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { ToneBadge } from "@/components/kit/badge"
import { ErrorState } from "@/components/kit/state-view"
import type { Tone } from "@/components/kit/tone"
import { askAbout, openModule, setContext, setContextTab } from "../lib/context-store"
import { startSync } from "../lib/actions"

const STAGES: Record<ContextTourStep["stage"], { label: string; hint: string; tone: Tone }> = {
  start: { label: "Start here", hint: "What runs first", tone: "brand" },
  core: { label: "Core", hint: "What everything leans on", tone: "info" },
  features: { label: "Features", hint: "In the order you reach them", tone: "neutral" },
  edges: { label: "Around the edges", hint: "Tests, docs and assets", tone: "neutral" },
}

const nameOf = (s: ContextTourStep) => (s.dir ? s.dir.split("/").pop()! : "(repo root)")

/** Short names, with the parent folder added where two modules share one (`server/security`, `features/security`). */
function labels(steps: ContextTourStep[]): Map<string, string> {
  const count = new Map<string, number>()
  for (const s of steps) count.set(nameOf(s), (count.get(nameOf(s)) ?? 0) + 1)
  return new Map(steps.map((s) => [s.moduleId, (count.get(nameOf(s)) ?? 0) > 1 ? s.dir.split("/").slice(-2).join("/") : nameOf(s)]))
}

/** A guided path through the modules for someone new: entry points, core, features, then the rest. */
export function TourPage() {
  const [tour, setTour] = useState<ContextTour | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    contextApi
      .tour()
      .then((t) => live && setTour(t))
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [])

  const save = (patch: Parameters<typeof contextApi.tourProgress>[0]) =>
    contextApi
      .tourProgress(patch)
      .then(setTour)
      .catch((e) => toast.error((e as Error).message))

  if (error && !tour) return <ErrorState title="Couldn't build the tour" error={error} onRetry={() => location.reload()} />
  if (!tour)
    return (
      <div className="mx-auto grid max-w-5xl gap-5 px-6 pt-6 lg:grid-cols-[280px_1fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )

  const currentId = viewing ?? tour.current ?? tour.steps.find((s) => !tour.done.includes(s.moduleId))?.moduleId ?? tour.steps[0]?.moduleId
  const index = Math.max(0, tour.steps.findIndex((s) => s.moduleId === currentId))
  const step = tour.steps[index]
  const go = (i: number) => {
    const next = tour.steps[i]
    if (!next) return
    setViewing(next.moduleId)
    void save({ current: next.moduleId })
  }

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-5xl items-start gap-5 px-4 pt-6 pb-24 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <StepRail tour={tour} currentId={currentId} onPick={(id) => go(tour.steps.findIndex((s) => s.moduleId === id))} onReset={() => void save({ reset: true }).then(() => setViewing(null))} />
        {step ? (
          <StepCard
            key={step.moduleId}
            step={step}
            label={labels(tour.steps).get(step.moduleId) ?? nameOf(step)}
            index={index}
            total={tour.steps.length}
            done={tour.done.includes(step.moduleId)}
            onPrev={index > 0 ? () => go(index - 1) : undefined}
            onDoneNext={() => {
              const nextIdx = index + 1 < tour.steps.length ? index + 1 : index
              setViewing(tour.steps[nextIdx]!.moduleId)
              void save({ done: { [step.moduleId]: true }, current: tour.steps[nextIdx]!.moduleId })
            }}
            onUndo={() => void save({ done: { [step.moduleId]: false } })}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No modules to tour yet.</p>
        )}
      </div>
    </div>
  )
}

function StepRail({ tour, currentId, onPick, onReset }: { tour: ContextTour; currentId?: string; onPick: (id: string) => void; onReset: () => void }) {
  const names = useMemo(() => labels(tour.steps), [tour.steps])
  const groups = useMemo(() => {
    const out: { stage: ContextTourStep["stage"]; steps: ContextTourStep[] }[] = []
    for (const s of tour.steps) {
      const last = out[out.length - 1]
      if (last?.stage === s.stage) last.steps.push(s)
      else out.push({ stage: s.stage, steps: [s] })
    }
    return out
  }, [tour.steps])
  const done = new Set(tour.done)
  const pct = tour.steps.length ? Math.round((done.size / tour.steps.length) * 100) : 0

  return (
    <nav aria-label="Tour steps" className="order-2 h-fit rounded-2xl border bg-surface lg:sticky lg:top-6 lg:order-none">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Onboarding tour</span>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {done.size}/{tour.steps.length}
          </span>
        </div>
        <Progress value={pct} className="mt-2 h-1" aria-label={`${pct}% done`} />
      </div>
      <div className="max-h-[42vh] overflow-y-auto py-2 lg:max-h-[calc(100vh-14rem)]">
        {groups.map((g) => (
          <div key={g.stage} className="pb-1">
            <p className="px-4 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{STAGES[g.stage].label}</p>
            <ul>
              {g.steps.map((s) => {
                const active = s.moduleId === currentId
                return (
                  <li key={s.moduleId}>
                    <button
                      onClick={() => onPick(s.moduleId)}
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                        active && "bg-accent font-medium"
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-full border",
                          done.has(s.moduleId) ? "tone-success tone-solid border-transparent" : active ? "border-brand" : "border-muted-foreground/40"
                        )}
                      >
                        {done.has(s.moduleId) && <CheckIcon className="size-2.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{names.get(s.moduleId)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {done.size > 0 && (
        <div className="border-t px-2 py-1.5">
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onReset}>
            <RotateCcwIcon data-icon="inline-start" /> Start over
          </Button>
        </div>
      )}
    </nav>
  )
}

function StepCard({
  step,
  label,
  index,
  total,
  done,
  onPrev,
  onDoneNext,
  onUndo,
}: {
  step: ContextTourStep
  label: string
  index: number
  total: number
  done: boolean
  onPrev?: () => void
  onDoneNext: () => void
  onUndo: () => void
}) {
  const stage = STAGES[step.stage]
  return (
    <article className="rounded-2xl border bg-surface">
      <header className="px-5 pt-5 pb-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ToneBadge tone={stage.tone} size="sm">
            {stage.label}
          </ToneBadge>
          <span>
            Step {index + 1} of {total}
          </span>
          <span aria-hidden>·</span>
          <span>{step.why}</span>
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight">{label}</h2>
        <p className="font-mono text-xs text-muted-foreground">{step.dir || "."}/</p>
        <p className="mt-3 text-[15px] leading-relaxed">{step.purpose}</p>
        {!step.hasCard && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground">
            <SparklesIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">No card yet, so this is from the code&apos;s exports. A card adds entry points, rules and gotchas.</span>
            <Button size="xs" variant="outline" onClick={() => startSync({ only: [step.moduleId] })}>
              Write card · ~2¢
            </Button>
          </div>
        )}
      </header>

      <section className="border-t px-5 py-4 sm:px-6">
        <h3 className="text-sm font-medium">Read these first</h3>
        <ul className="mt-2 space-y-1.5">
          {step.keyFiles.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => setContext({ peek: { path: f.path, ...(f.line ? { line: f.line } : {}) } })}
                className="group flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <FileCodeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">
                    {f.path}
                    {f.line ? <span className="text-muted-foreground">:{f.line}</span> : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{f.note}</span>
                </span>
              </button>
            </li>
          ))}
          {!step.keyFiles.length && <li className="text-sm text-muted-foreground">No source files here.</li>}
        </ul>
      </section>

      <section className="border-t px-5 py-4 sm:px-6">
        <h3 className="text-sm font-medium">Check your understanding</h3>
        <button
          onClick={() => askAbout(step.tryAsk)}
          className="mt-2 flex w-full items-center gap-3 rounded-xl bg-sunken px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
        >
          <MessageSquareTextIcon className="size-4 shrink-0 text-brand" />
          <span className="min-w-0 flex-1">{step.tryAsk}</span>
          <span className="shrink-0 text-xs text-muted-foreground">Ask</span>
        </button>
      </section>

      <footer className="flex flex-wrap items-center gap-2 border-t px-5 py-3 sm:px-6">
        <Button size="sm" variant="ghost" onClick={onPrev} disabled={!onPrev}>
          <ArrowLeftIcon data-icon="inline-start" /> Back
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setContextTab("map")
            openModule(step.moduleId)
          }}
        >
          <MapIcon data-icon="inline-start" /> On the map
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {done && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onUndo}>
              Not done
            </Button>
          )}
          <Button size="sm" onClick={onDoneNext}>
            {index + 1 < total ? (
              <>
                {done ? "Next" : "Got it, next"} <ArrowRightIcon data-icon="inline-end" />
              </>
            ) : (
              <>
                <CheckIcon data-icon="inline-start" /> Finish
              </>
            )}
          </Button>
        </div>
      </footer>
    </article>
  )
}
