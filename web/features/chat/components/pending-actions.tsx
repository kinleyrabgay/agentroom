"use client"

import { useMemo, useState } from "react"
import { ClipboardCheckIcon, CircleAlertIcon, MessageCircleQuestionIcon, PlayIcon } from "lucide-react"
import { toast } from "sonner"
import { GoalStatus, plainText, type Bot, type Goal, type Notification } from "@shared"
import { goalApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { pendingApprovals } from "@/lib/store/selectors"
import { Button } from "@/components/ui/button"
import { ToneBadge, ToneDot } from "@/components/kit/badge"
import { ApprovalCard } from "@/features/approvals/components/approval-card"
import { QuestionAnswer } from "@/features/inbox/components/question-answer"
import { needsAnswer } from "@/features/inbox/lib/route"

/** Everything waiting on the human for this bot, shown at the end of its chat thread. */
export function usePendingActions(bot: Bot) {
  const events = useAppStore((s) => s.events)
  const notifications = useAppStore((s) => s.notifications)
  const goals = useAppStore((s) => s.goals)
  return useMemo(() => {
    const isLead = !bot.reportsTo
    return {
      approvals: pendingApprovals(events).filter((p) => p.botId === bot.id),
      questions: notifications.filter((n) => n.botId === bot.id && needsAnswer(n)),
      // The lead owns goals; the planner hands its plan over for review.
      goals: goals.filter(
        (g) =>
          (g.status === GoalStatus.AwaitingApproval && (isLead || bot.role === "planner")) ||
          (g.status === GoalStatus.Paused && isLead && !!g.reason)
      ),
    }
  }, [events, notifications, goals, bot])
}

export function PendingActions({ pending: { approvals, questions, goals } }: { pending: ReturnType<typeof usePendingActions> }) {
  if (!approvals.length && !questions.length && !goals.length) return null

  return (
    <div className="space-y-3" aria-label="Waiting for you">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ToneDot tone="warning" pulse /> Waiting for you
      </p>
      {questions.map((n) => (
        <QuestionCard key={n.id} n={n} />
      ))}
      {goals.map((g) => (
        <GoalCard key={g.id} goal={g} />
      ))}
      {approvals.map((p) => (
        <ApprovalCard key={p.requestId} request={p} />
      ))}
    </div>
  )
}

function QuestionCard({ n }: { n: Notification }) {
  return (
    <div className="space-y-2.5 rounded-xl border bg-card p-3.5 shadow-xs">
      <div className="flex items-center gap-2">
        <ToneBadge tone="info" icon={MessageCircleQuestionIcon} size="sm">
          Question
        </ToneBadge>
        <span className="truncate text-xs text-muted-foreground">{n.title}</span>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{n.body}</p>
      <QuestionAnswer n={n} />
    </div>
  )
}

function GoalCard({ goal }: { goal: Goal }) {
  const taskCount = useAppStore((s) => s.tasks.filter((t) => t.goalId === goal.id).length)
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const [busy, setBusy] = useState(false)
  const awaiting = goal.status === GoalStatus.AwaitingApproval

  const act = async () => {
    setBusy(true)
    try {
      if (awaiting) {
        await goalApi.approve(goal.id)
        toast.success("Plan approved", { description: "The Developer is starting on the first task." })
      } else {
        await goalApi.resume(goal.id)
        toast.success(`${goal.id} resumed`)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const Icon = awaiting ? ClipboardCheckIcon : CircleAlertIcon
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3.5 shadow-xs">
      <div className="flex items-center gap-2">
        <ToneBadge tone="warning" icon={Icon} size="sm">
          {awaiting ? "Plan ready for review" : "Paused, needs you"}
        </ToneBadge>
        <span className="font-mono text-xs text-muted-foreground">{goal.id}</span>
      </div>
      <p className="text-sm font-medium">{goal.title}</p>
      <p className="text-xs text-muted-foreground">
        {awaiting
          ? `${taskCount} ${taskCount === 1 ? "task" : "tasks"} planned. Review or edit them on the board; nothing is built until you approve.`
          : plainText(goal.reason ?? "", 280)}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={act} disabled={busy || (awaiting && taskCount === 0)}>
          {awaiting ? <ClipboardCheckIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          {awaiting ? "Approve plan" : "Resume"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => showOnTasks({ goalId: goal.id })}>
          {awaiting ? "Review on board" : "Open goal"}
        </Button>
      </div>
    </div>
  )
}
