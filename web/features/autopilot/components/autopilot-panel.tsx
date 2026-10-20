"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, ExternalLinkIcon, FlaskConicalIcon, RotateCwIcon, SirenIcon, type LucideIcon } from "lucide-react"
import type { AutopilotFactor, Goal } from "@shared"
import { autopilotApi } from "@/lib/api/endpoints"
import { timeAgo } from "@/lib/time"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ToneBadge } from "@/components/kit/badge"
import { TONE_CLASS, type Tone } from "@/components/kit/tone"
import { isRunning } from "@/features/tasks/lib/goal-phase"
import { AUTOPILOT_STATUS, confidenceTone } from "../lib/meta"

/** Autopilot evidence on the goal's Proof tab: reproduced?, the failing test, fail → pass, confidence. */
export function AutopilotPanel({ goal }: { goal: Goal }) {
  const a = goal.autopilot!
  const [busy, setBusy] = useState(false)
  const status = AUTOPILOT_STATUS[a.status]
  const v = a.verification
  const recheck = async () => {
    setBusy(true)
    try {
      await autopilotApi.verify(goal.id)
      toast.success("Checked the failing test again")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Autopilot" className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <SirenIcon className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">Autopilot</h3>
        {a.permalink ? (
          <a href={a.permalink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground">
            {a.shortId} <ExternalLinkIcon className="size-3" aria-hidden />
          </a>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">{a.shortId}</span>
        )}
        <ToneBadge tone={status.tone} dot size="sm">
          {status.label}
        </ToneBadge>
        <div className="ml-auto flex items-center gap-2">
          {a.test && (
            <Button size="sm" variant="outline" disabled={busy || isRunning(goal.status)} onClick={recheck}>
              <RotateCwIcon data-icon="inline-start" className={cn(busy && "animate-spin")} /> Check again
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-0 md:grid-cols-[1fr_15rem]">
        <ol className="space-y-3 p-4">
          <Step
            state={a.reproduced === true ? "ok" : a.reproduced === false ? "fail" : "wait"}
            title={a.reproduced === false ? "Couldn't reproduce" : "Reproduce the error"}
            detail={a.how ?? "The team reproduces the error before changing any code."}
          />
          <Step
            state={a.test ? "ok" : "wait"}
            title="Failing test"
            detail={
              a.test ? (
                <span className="flex flex-col gap-0.5">
                  <code className="font-mono text-xs break-all">{a.test.file}</code>
                  <code className="font-mono text-xs break-all text-muted-foreground">{a.test.command}</code>
                </span>
              ) : (
                "A test that fails because of the bug."
              )
            }
          />
          <Step
            state={!v ? "wait" : v.failsOnBase === true ? "ok" : "fail"}
            title="Fails on the starting commit"
            detail={!v ? "Checked by AgentRoom, not the bot." : v.failsOnBase === true ? "The test catches the bug." : v.failsOnBase === false ? "The test passes without the fix, so it doesn't prove the bug." : "Couldn't run it on the starting commit."}
          />
          <Step
            state={!v ? "wait" : v.passesOnHead === true ? "ok" : "fail"}
            title="Passes on the fix"
            detail={!v ? "Checked before the report." : v.passesOnHead === true ? `Checked ${timeAgo(Date.parse(v.at))}.` : v.passesOnHead === false ? "The test still fails with the fix." : "Couldn't run it on the fix."}
          />
          {v?.detail && (v.failsOnBase !== true || v.passesOnHead !== true) && (
            <pre className="max-h-40 overflow-auto rounded-lg border bg-sunken/60 p-2.5 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{v.detail}</pre>
          )}
        </ol>
        <Confidence goal={goal} />
      </div>
    </section>
  )
}

function Step({ state, title, detail }: { state: "ok" | "fail" | "wait"; title: string; detail: React.ReactNode }) {
  const meta: Record<typeof state, { icon: LucideIcon; tone: Tone; label: string }> = {
    ok: { icon: CircleCheckIcon, tone: "success", label: "Done" },
    fail: { icon: CircleXIcon, tone: "danger", label: "Failed" },
    wait: { icon: CircleDashedIcon, tone: "neutral", label: "Not yet" },
  }
  const m = meta[state]
  return (
    <li className="flex gap-3">
      <span className={cn(TONE_CLASS[m.tone], "tone-text mt-0.5")}>
        <m.icon className="size-4" aria-label={m.label} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </li>
  )
}

function Confidence({ goal }: { goal: Goal }) {
  const c = goal.autopilot!.confidence
  return (
    <aside aria-label="Confidence" className="space-y-3 border-t bg-sunken/40 p-4 md:border-t-0 md:border-l">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Confidence</span>
        {goal.autopilot!.autoPr ? <span className="text-xs text-muted-foreground">PR opens when confident</span> : <span className="text-xs text-muted-foreground">PR waits for you</span>}
      </div>
      {c ? (
        <>
          <p className={cn(TONE_CLASS[confidenceTone(c.score)], "tone-text text-3xl font-semibold tabular-nums")}>
            {c.score}
            <span className="text-base font-normal text-muted-foreground">/100</span>
          </p>
          <Meter value={c.score} tone={confidenceTone(c.score)} />
          <ul className="space-y-1.5">
            {c.factors.map((f) => (
              <Factor key={f.label} f={f} />
            ))}
          </ul>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FlaskConicalIcon className="size-4" aria-hidden /> Scored once the fix is tested.
        </p>
      )}
    </aside>
  )
}

function Factor({ f }: { f: AutopilotFactor }) {
  return (
    <li className="text-xs" title={f.detail}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("truncate", f.ok === false && cn(TONE_CLASS.danger, "tone-text"))}>{f.label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {f.points}/{f.max}
        </span>
      </div>
      {f.detail && <p className="truncate text-muted-foreground">{f.detail}</p>}
    </li>
  )
}

function Meter({ value, tone }: { value: number; tone: Tone }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Confidence">
      <div className={cn(TONE_CLASS[tone], "tone-solid h-full rounded-full")} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}
