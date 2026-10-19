"use client"

import { useState } from "react"
import { CircleAlertIcon, PauseCircleIcon, RepeatIcon } from "lucide-react"
import { toast } from "sonner"
import { GoalStatus, type Goal, type Task } from "@shared"
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
  const stopped = STOPPED[goal.status]
  const meta = GOAL_STATUS_META[goal.status]

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
        <GoalActions goal={goal} />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <PhaseStepper current={phaseIndex(goal, tasks)} stopped={!!stopped} />
        {total > 0 && (
          <div className="flex min-w-40 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <Progress value={(done / total) * 100} className="h-1.5" />
            <span className="shrink-0 tabular-nums">
              {done}/{total} done
            </span>
          </div>
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
          {goal.reason && <AlertDescription>{goal.reason}</AlertDescription>}
        </Alert>
      )}

      <div className="grid gap-2">
        <ReportSection goal={goal} />
        <PlanSection goal={goal} />
      </div>
    </section>
  )
}
