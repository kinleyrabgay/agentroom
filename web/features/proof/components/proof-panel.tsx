"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClapperboardIcon,
  ExternalLinkIcon,
  PencilIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { GoalStatus, type Goal, type ProofCheck, type ProofFrame, type ProofScenarioResult, type ProofView } from "@shared"
import { proofApi } from "@/lib/api/endpoints"
import { timeAgo } from "@/lib/time"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/kit/callout"
import { ToneBadge } from "@/components/kit/badge"
import { Segmented } from "@/components/kit/segmented"
import { EmptyState, ErrorState } from "@/components/kit/state-view"
import { TONE_CLASS, type Tone } from "@/components/kit/tone"
import { isRunning } from "@/features/tasks/lib/goal-phase"
import { proofFileUrl } from "../lib/proof-url"
import { FrameDialog } from "./frame-dialog"
import { ScenarioDialog } from "./scenario-dialog"

const STATUS: Record<NonNullable<ProofView["report"]>["status"], { label: string; tone: Tone }> = {
  passed: { label: "Proof passed", tone: "success" },
  failed: { label: "Proof failed", tone: "danger" },
  skipped: { label: "Not recorded", tone: "neutral" },
  error: { label: "Couldn't record", tone: "warning" },
}
const CHECK: Record<ProofCheck["status"], { tone: Tone; icon: LucideIcon; label: string }> = {
  pass: { tone: "success", icon: CircleCheckIcon, label: "Pass" },
  warn: { tone: "warning", icon: TriangleAlertIcon, label: "Look" },
  fail: { tone: "danger", icon: CircleXIcon, label: "Fail" },
  skipped: { tone: "neutral", icon: CircleDashedIcon, label: "Skipped" },
}

/** A goal's Proof tab: the recording of the feature working, before/after, and quality checks. */
export function ProofPanel({ goal }: { goal: Goal }) {
  const [view, setView] = useState<ProofView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      proofApi
        .get(goal.id)
        .then((v) => {
          setView(v)
          setError(null)
        })
        .catch((e: Error) => setError(e.message)),
    [goal.id]
  )

  // Reload when the goal's proof changes; poll while it's being recorded.
  const recording = goal.status === GoalStatus.Verifying || !!view?.running
  useEffect(() => {
    void load()
  }, [load, goal.proof?.at, goal.status])
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [recording, load])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !view) return <ErrorState error={error} onRetry={() => void load()} />
  if (!view) return <Skeleton className="h-72 w-full rounded-xl" />

  const report = view.report
  const failingChecks = report?.checks.filter((c) => c.status === "fail") ?? []
  const accepted = goal.proofOverride?.round === goal.round
  const canRun = view.availability.ok && !!goal.approvedAt && !isRunning(goal.status) && !view.running

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <PencilIcon data-icon="inline-start" /> Scenario
      </Button>
      <Button size="sm" variant="outline" disabled={!canRun || busy} onClick={() => act(() => proofApi.run(goal.id), "Recording proof again")}>
        <RotateCwIcon data-icon="inline-start" className={cn(view.running && "animate-spin")} /> {view.running ? "Recording…" : "Record again"}
      </Button>
    </div>
  )

  return (
    <div className="space-y-4">
      {!view.availability.ok && (
        <Callout tone="info" title="Proof recording is off on this machine">
          {view.availability.reason}
        </Callout>
      )}

      {!report ? (
        <>
          <div className="flex justify-end">{actions}</div>
          <EmptyState
            compact
            icon={ClapperboardIcon}
            title={recording ? "Recording proof…" : "No proof yet"}
            description={
              recording
                ? "The app is starting in the goal's folder. The recording and checks show up here."
                : "After QA passes, the Verify step opens the app in a headless browser, records the feature working and runs accessibility, performance and visual checks. The PR shows the result."
            }
            className="rounded-xl border border-dashed"
          />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ToneBadge tone={STATUS[report.status].tone} dot pulse={recording}>
              {recording ? "Recording…" : STATUS[report.status].label}
            </ToneBadge>
            <span className="text-xs text-muted-foreground">
              Round {report.round + 1} · {timeAgo(Date.parse(report.finishedAt))}
            </span>
            {report.published && (
              <ToneBadge tone="info" icon={ExternalLinkIcon}>
                On {report.published.branch}
              </ToneBadge>
            )}
            <div className="ml-auto">{actions}</div>
          </div>

          {(report.status === "skipped" || report.status === "error") && report.reason && (
            <Callout tone={report.status === "error" ? "warning" : "neutral"} title={report.status === "error" ? "The recording stopped" : "Nothing to record"}>
              <span className="whitespace-pre-wrap">{report.reason}</span>
            </Callout>
          )}

          {failingChecks.length > 0 && (
            <Callout
              tone={accepted ? "neutral" : "danger"}
              icon={accepted ? ShieldCheckIcon : undefined}
              title={accepted ? `Accepted by ${goal.proofOverride!.by.replace(/\s*<.*>$/, "")}` : `${failingChecks.length} quality ${failingChecks.length === 1 ? "check fails" : "checks fail"}`}
              action={
                !accepted && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => proofApi.override(goal.id), "Accepted; the goal continues")}>
                    Accept and continue
                  </Button>
                )
              }
            >
              {failingChecks.map((c) => `${c.label}: ${c.summary}`).join(" · ")}
            </Callout>
          )}

          {report.scenarios.map((s, i) => (
            <ScenarioCard key={`${s.name}-${i}`} goalId={goal.id} scenario={s} version={report.finishedAt} />
          ))}

          {report.checks.length > 0 && <ChecksList checks={report.checks} />}
        </>
      )}

      <ScenarioDialog
        open={editing}
        onOpenChange={setEditing}
        scenarios={view.scenarios}
        onSave={async (list) => {
          await proofApi.setScenarios(goal.id, list)
          toast.success("Scenario saved", { description: canRun ? "Record again to use it." : "It's used the next time proof is recorded." })
          await load()
        }}
      />
    </div>
  )
}

type Mode = "recording" | "steps" | "compare"

function ScenarioCard({ goalId, scenario, version }: { goalId: string; scenario: ProofScenarioResult; version: string }) {
  const hasBefore = scenario.before.length > 0
  const [mode, setMode] = useState<Mode>(scenario.gif ? "recording" : "steps")
  const [open, setOpen] = useState<ProofFrame | null>(null)
  const url = (file: string) => proofFileUrl(goalId, file, version)
  const after = scenario.frames[scenario.frames.length - 1]

  const options: { value: Mode; label: string }[] = [
    ...(scenario.gif ? [{ value: "recording" as const, label: "Recording" }] : []),
    { value: "steps", label: `Steps ${scenario.frames.length}` },
    ...(hasBefore ? [{ value: "compare" as const, label: "Before / after" }] : []),
  ]

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        {scenario.ok ? <CircleCheckIcon className="size-4 text-success" aria-hidden /> : <CircleXIcon className="size-4 text-danger" aria-hidden />}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{scenario.name}</h3>
        {options.length > 1 && <Segmented<Mode> size="sm" aria-label={`${scenario.name} view`} value={mode} onChange={setMode} options={options} />}
      </header>
      {scenario.error && (
        <p className={cn(TONE_CLASS[scenario.ok ? "warning" : "danger"], "tone-soft border-b px-4 py-2 text-sm")}>{scenario.error}</p>
      )}
      <div className="bg-sunken/50 p-4">
        {mode === "recording" && scenario.gif ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url(scenario.gif)} alt={`Recording: ${scenario.name}`} className="mx-auto max-h-[60vh] w-auto rounded-lg border bg-background shadow-sm" />
        ) : mode === "compare" && hasBefore && after ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Shot label="Before" src={url(scenario.before[0].file)} onOpen={() => setOpen(scenario.before[0])} />
            <Shot label="After" src={url(after.file)} onOpen={() => setOpen(after)} />
          </div>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2">
            {scenario.frames.map((f) => (
              <li key={f.file}>
                <Shot label={f.label} src={url(f.file)} failed={!f.ok} onOpen={() => setOpen(f)} />
              </li>
            ))}
          </ol>
        )}
      </div>
      <FrameDialog frame={open} src={open ? url(open.file) : ""} onOpenChange={(v) => !v && setOpen(null)} />
    </section>
  )
}

function Shot({ label, src, failed, onOpen }: { label: string; src: string; failed?: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group block w-full overflow-hidden rounded-lg border bg-background text-left shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} loading="lazy" className="aspect-[16/10] w-full object-cover object-top transition-opacity group-hover:opacity-90" />
      <span className={cn("flex items-center gap-1.5 border-t px-2.5 py-1.5 text-xs", failed ? cn(TONE_CLASS.danger, "tone-text") : "text-muted-foreground")}>
        {failed && <CircleXIcon className="size-3.5 shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
      </span>
    </button>
  )
}

function ChecksList({ checks }: { checks: ProofCheck[] }) {
  return (
    <section aria-label="Quality checks" className="overflow-hidden rounded-xl border bg-card">
      <h3 className="border-b px-4 py-2.5 text-sm font-medium">Quality checks</h3>
      <ul className="divide-y">
        {checks.map((c) => {
          const meta = CHECK[c.status]
          return (
            <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
              <span className={cn(TONE_CLASS[meta.tone], "tone-text mt-0.5")}>
                <meta.icon className="size-4" aria-label={meta.label} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{c.label}</span> <span className="text-muted-foreground">· {c.summary}</span>
                </p>
                {c.details && c.details.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {c.details.slice(0, 6).map((d) => (
                      <li key={d} className="truncate">
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
