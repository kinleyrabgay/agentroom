"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowRightIcon, ExternalLinkIcon, Loader2Icon, SirenIcon } from "lucide-react"
import type { AutopilotIssueRun } from "@shared"
import { autopilotApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { timeAgo } from "@/lib/time"
import { cn } from "@/lib/utils"
import { DetailSection } from "@/components/shared/inspector-panel"
import { Button } from "@/components/ui/button"
import { ToneBadge } from "@/components/kit/badge"
import { TONE_CLASS } from "@/components/kit/tone"
import { AUTOPILOT_STATUS, confidenceTone } from "../lib/meta"

/** Sentry issue Inspector: start autopilot for the issue and follow its runs. */
export function AutopilotSection({ issueId, shortId }: { issueId: string; shortId: string }) {
  const [runs, setRuns] = useState<AutopilotIssueRun[] | null>(null)
  const [busy, setBusy] = useState(false)
  const goals = useAppStore((s) => s.goals)
  const showOnTasks = useAppStore((s) => s.showOnTasks)

  const load = useCallback(
    () =>
      autopilotApi
        .runs(issueId)
        .then(setRuns)
        .catch(() => setRuns([])),
    [issueId]
  )
  // Refresh when any goal changes (status, confidence).
  useEffect(() => {
    void load()
  }, [load, goals])

  const active = runs?.find((r) => !["done", "cancelled", "failed"].includes(r.goalStatus))
  const start = async () => {
    setBusy(true)
    try {
      const goal = await autopilotApi.start(issueId)
      toast.success(`${goal.id} started`, { description: "Reproduce first, then a failing test, then the fix. The plan waits for you." })
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DetailSection title="Autopilot" icon={SirenIcon} count={runs?.length}>
      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <p className="min-w-52 flex-1 text-sm text-muted-foreground">
            Reproduce {shortId}, prove it with a failing test, fix it. AgentRoom checks the test fails before and passes after, then scores its confidence. The PR waits for you.
          </p>
          <Button size="sm" onClick={start} disabled={busy || !!active}>
            {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SirenIcon data-icon="inline-start" />}
            {active ? "Running" : "Run autopilot"}
          </Button>
        </div>
        {runs && runs.length > 0 && (
          <ul className="divide-y border-t">
            {runs.map((r) => {
              const s = AUTOPILOT_STATUS[r.status]
              return (
                <li key={r.goalId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{r.goalId}</span>
                  <ToneBadge tone={s.tone} size="sm" dot>
                    {s.label}
                  </ToneBadge>
                  {r.confidence !== undefined && (
                    <span className={cn(TONE_CLASS[confidenceTone(r.confidence)], "tone-text text-xs font-medium tabular-nums")}>{r.confidence}/100</span>
                  )}
                  <span className="text-xs text-muted-foreground">{timeAgo(Date.parse(r.startedAt))}</span>
                  <div className="ml-auto flex items-center gap-1">
                    {r.pr && (
                      <Button asChild size="xs" variant="ghost">
                        <a href={r.pr} target="_blank" rel="noreferrer noopener">
                          PR <ExternalLinkIcon data-icon="inline-end" />
                        </a>
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => showOnTasks({ goalId: r.goalId })}>
                      Open <ArrowRightIcon data-icon="inline-end" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DetailSection>
  )
}
