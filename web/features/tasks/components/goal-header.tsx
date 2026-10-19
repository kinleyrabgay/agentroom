"use client"

import { useState } from "react"
import { CircleAlertIcon, Loader2Icon, PauseCircleIcon, RepeatIcon, ShieldAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { GoalStatus, RiskLevel, SecurityReviewMode, type Goal, type Task } from "@shared"
import { GoalTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { RiskBadge } from "@/features/security/components/risk-badge"
import { ReviewModeSelect } from "@/features/security/components/review-mode-select"
import { useFindingCounts } from "@/features/security/hooks/use-finding-counts"
import { cn } from "@/lib/utils"
import { goalApi } from "@/lib/api/endpoints"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { GOAL_STATUS_META } from "../constants"
import { goalProgress, phaseIndex } from "../lib/goal-phase"
import { GoalActions } from "./goal-actions"
import { PlanSection, ReportSection } from "./goal-sections"
import { PhaseStepper } from "./phase-stepper"
import { useGoalSpend } from "../hooks/use-goal-spend"
import { usd } from "@/features/usage/lib/format"

const STOPPED: Partial<
  Record<GoalStatus, { title: string; destructive: boolean }>
> = {
  [GoalStatus.Paused]: {
    title: "Paused — waiting for you",
    destructive: false,
  },
  [GoalStatus.Failed]: { title: "Goal failed", destructive: true },
  [GoalStatus.Cancelled]: { title: "Cancelled", destructive: false },
}

export function GoalHeader({ goal, tasks }: { goal: Goal; tasks: Task[] }) {
  // null = not editing: show the server's title (which may change while the run goes on).
  const [draft, setDraft] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  const title = draft ?? goal.title

  const { done, total } = goalProgress(tasks)
  const spend = useGoalSpend(goal.id)
  const stopped = STOPPED[goal.status]
  const meta = GOAL_STATUS_META[goal.status]
  const setGoalTab = useAppStore((s) => s.setGoalTab)
  const findingCounts = useFindingCounts(goal.id)
  const openFindings = findingCounts.openCritical + findingCounts.openWarning
  // A stop is about security when findings are open or the reason says so.
  const securityStop = !!stopped && (openFindings > 0 || /secur|risk|finding/i.test(goal.reason ?? ""))
  const reviewMode = goal.securityReview ?? SecurityReviewMode.Auto
  const securitySkip =
    reviewMode === SecurityReviewMode.Off
      ? "off"
      : reviewMode === SecurityReviewMode.Auto && goal.risk?.level === RiskLevel.Low && goal.status !== GoalStatus.Securing
        ? "low risk"
        : undefined

  const setReviewMode = (securityReview: SecurityReviewMode) =>
    goalApi.update(goal.id, { securityReview }).catch((e: Error) => toast.error(e.message))

  const saveTitle = () => {
    const t = (draft ?? "").trim()
    setDraft(null)
    if (t && t !== goal.title)
      goalApi
        .update(goal.id, { title: t })
        .catch((e: Error) => toast.error(e.message))
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {goal.id}
            </span>
            <Badge variant="secondary" className="gap-1.5 font-normal">
              <span className={cn("size-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </Badge>
            {goal.risk && <RiskBadge risk={goal.risk} />}
            {goal.round > 0 && (
              <Badge
                variant="outline"
                className="gap-1 font-normal"
                title="Bug-fix rounds after QA"
              >
                <RepeatIcon className="size-3" /> Round {goal.round + 1}
              </Badge>
            )}
          </div>
          <input
            value={title}
            onFocus={() => setDraft(goal.title)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.target as HTMLInputElement).blur()
            }
            aria-label="Goal title"
            className="mt-1 w-full truncate rounded-md bg-transparent text-lg font-semibold outline-none focus:bg-muted/40 focus:px-1.5"
          />
          <button
            onClick={() => setBriefOpen(!briefOpen)}
            className={cn(
              "mt-0.5 text-left text-sm text-muted-foreground",
              !briefOpen && "line-clamp-1"
            )}
          >
            {goal.brief}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReviewModeSelect value={reviewMode} onChange={setReviewMode} className="h-8" />
          <GoalActions goal={goal} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <PhaseStepper current={phaseIndex(goal, tasks)} stopped={!!stopped} skipped={securitySkip ? { security: securitySkip } : undefined} />
        {goal.status === GoalStatus.Securing && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" /> Security Auditor reviewing…
          </span>
        )}
        {total > 0 && (
          <div className="flex min-w-40 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <Progress value={(done / total) * 100} className="h-1.5" />
            <span className="shrink-0 tabular-nums">
              {done}/{total} done
            </span>
          </div>
        )}
        {spend && spend.runs > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums" title="From the run ledger: every bot run for this goal">
            Spent {usd(spend.costUsd)} · {spend.runs} {spend.runs === 1 ? "run" : "runs"}
          </span>
        )}
      </div>

      {stopped && (
        <Alert
          variant={stopped.destructive ? "destructive" : "default"}
          className={cn(
            !stopped.destructive && "border-amber-500/30 bg-amber-500/5"
          )}
        >
          {stopped.destructive ? (
            <CircleAlertIcon />
          ) : (
            <PauseCircleIcon className="text-amber-600 dark:text-amber-300" />
          )}
          <AlertTitle>{stopped.title}</AlertTitle>
          {(goal.reason || securityStop) && (
            <AlertDescription>
              {goal.reason}
              {securityStop && (
                <Button size="xs" variant="outline" className="mt-1.5 w-fit" onClick={() => setGoalTab(GoalTab.Security)}>
                  <ShieldAlertIcon data-icon="inline-start" /> Review findings
                  {openFindings > 0 && ` (${openFindings})`}
                </Button>
              )}
            </AlertDescription>
          )}
        </Alert>
      )}

      <div className="grid gap-2">
        <ReportSection goal={goal} />
        <PlanSection goal={goal} />
      </div>
    </section>
  )
}
