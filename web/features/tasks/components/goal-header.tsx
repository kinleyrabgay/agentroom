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
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { Progress } from "@/components/ui/progress"
import { GOAL_STATUS_META } from "../constants"
import { goalProgress, phaseIndex } from "../lib/goal-phase"
import { GoalActions } from "./goal-actions"
import { PlanSection, ReportSection } from "./goal-sections"
import { PhaseStepper } from "./phase-stepper"
import { useGoalSpend } from "../hooks/use-goal-spend"
import { usd } from "@/features/usage/lib/format"
import { GoalBudget } from "./goal-budget"
import { GoalBranch, PublishActions } from "./goal-publish"
import { useBudget } from "../hooks/use-budget"
import { OctagonXIcon, PlusIcon } from "lucide-react"
import { GoalAttachments } from "@/features/attachments/components/goal-attachments"

const STOPPED: Partial<
  Record<GoalStatus, { title: string; destructive: boolean }>
> = {
  [GoalStatus.Paused]: {
    title: "Paused, waiting for you",
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
  const budgetStop = !!stopped && goal.status === GoalStatus.Paused && (goal.reason ?? "").startsWith(BUDGET_PAUSE)
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{goal.id}</span>
            <ToneBadge tone={meta.tone} dot pulse={meta.live}>
              {meta.label}
            </ToneBadge>
            {goal.risk && <RiskBadge risk={goal.risk} />}
            <GoalBranch goal={goal} />
            {goal.round > 0 && (
              <ToneBadge icon={RepeatIcon} aria-label="Bug-fix rounds after QA">
                Round {goal.round + 1}
              </ToneBadge>
            )}
          </div>
          <input
            value={title}
            onFocus={() => setDraft(goal.title)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Goal title"
            className="-mx-1.5 w-[calc(100%+0.75rem)] truncate rounded-lg bg-transparent px-1.5 text-xl font-semibold tracking-tight outline-none hover:bg-accent/50 focus:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <button
            onClick={() => setBriefOpen(!briefOpen)}
            aria-expanded={briefOpen}
            className={cn(
              "block max-w-3xl rounded-md text-left text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              !briefOpen && "line-clamp-2"
            )}
          >
            {goal.brief}
          </button>
          {(goal.attachments?.length ?? 0) > 0 && <GoalAttachments ids={goal.attachments} className="pt-1" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReviewModeSelect value={reviewMode} onChange={setReviewMode} className="h-8" />
          <GoalActions goal={goal} />
          <PublishActions goal={goal} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-surface px-3 py-2.5">
        <PhaseStepper
          current={phaseIndex(goal, tasks)}
          waiting={!!stopped || goal.status === GoalStatus.AwaitingApproval}
          skipped={securitySkip ? { security: securitySkip } : undefined}
        />
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {goal.status === GoalStatus.Securing && (
            <span className="flex items-center gap-1.5">
              <Loader2Icon className="size-3.5 animate-spin" /> Security Auditor reviewing
            </span>
          )}
          {total > 0 && (
            <span className="flex items-center gap-2">
              <Progress value={(done / total) * 100} className="h-1.5 w-24" />
              <span className="tabular-nums">
                {done}/{total} done
              </span>
            </span>
          )}
          {spend && spend.runs > 0 && (
            <span className="tabular-nums" title="From the run ledger: every bot run for this goal">
              {spend.runs} {spend.runs === 1 ? "run" : "runs"}
            </span>
          )}
          <GoalBudget goal={goal} />
        </div>
      </div>

      {stopped && (
        <Callout
          tone={stopped.destructive ? "danger" : "warning"}
          icon={stopped.destructive ? CircleAlertIcon : PauseCircleIcon}
          title={stopped.title}
          action={
            budgetStop ? (
              <BudgetActions goal={goal} />
            ) : (
            securityStop && (
              <Button size="sm" variant="outline" className="bg-surface" onClick={() => setGoalTab(GoalTab.Security)}>
                <ShieldAlertIcon data-icon="inline-start" /> Review findings
                {openFindings > 0 && ` (${openFindings})`}
              </Button>
            ))
          }
        >
          {goal.reason}
        </Callout>
      )}

      <div className="grid gap-2">
        <ReportSection goal={goal} />
        <PlanSection goal={goal} />
      </div>
    </section>
  )
}

/** Matches the server's budget pause reason prefix ("Budget: …"). */
const BUDGET_PAUSE = "Budget:"
/** How much "Add … and resume" raises a capped goal's budget by. */
const TOP_UP_USD = 3

/** Paused at a cap: add a little budget and continue, or stop the goal. */
function BudgetActions({ goal }: { goal: Goal }) {
  const budget = useBudget()
  const [busy, setBusy] = useState(false)
  const dayCapped = (goal.reason ?? "").includes("today")
  const row = budget?.goals[goal.id]
  const topUp = async () => {
    setBusy(true)
    try {
      const base = Math.max(row?.cap ?? 0, row?.spent ?? 0)
      await goalApi.update(goal.id, { budgetUsd: Math.round((base + TOP_UP_USD) * 100) / 100 })
      await goalApi.resume(goal.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" className="bg-surface" onClick={() => goalApi.cancel(goal.id).catch((e: Error) => toast.error(e.message))}>
        <OctagonXIcon data-icon="inline-start" /> Stop goal
      </Button>
      {!dayCapped && (
        <Button size="sm" onClick={topUp} disabled={busy}>
          <PlusIcon data-icon="inline-start" /> Add {usd(TOP_UP_USD)} and resume
        </Button>
      )}
    </>
  )
}
