"use client"

import { useMemo, useState } from "react"
import { KanbanSquareIcon, ListTodoIcon, PlusIcon, RocketIcon } from "lucide-react"
import { GoalStatus } from "@shared"
import { GoalTab } from "@/lib/constants"
import { ALL_TASKS, useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState } from "@/components/kit/state-view"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { PageActions } from "@/components/layout/page-actions"
import { GoalSecurityPanel } from "@/features/security/components/goal-security-panel"
import { TASK_COLUMNS } from "../constants"
import { byOrder, newestFirst } from "../lib/goal-phase"
import { ApprovalBanner } from "./approval-banner"
import { GoalHeader } from "./goal-header"
import { GoalList } from "./goal-list"
import { GoalTabs } from "./goal-tabs"
import { ChangesPanel } from "./changes-panel"
import { GoalTimeline } from "@/features/replay/components/goal-timeline"
import { NewGoalDialog } from "./new-goal-dialog"
import { QuickAddTask } from "./quick-add-task"
import { TaskColumn } from "./task-column"

/** Work: goals on the left; the selected goal (plan review, progress, tasks) on the right. */
export function TaskBoard() {
  const loaded = useAppStore((s) => s.info !== null)
  const goals = useAppStore((s) => s.goals)
  const tasks = useAppStore((s) => s.tasks)
  const selectedGoalId = useAppStore((s) => s.selectedGoalId)
  const selectGoal = useAppStore((s) => s.selectGoal)
  const goalTab = useAppStore((s) => s.goalTab)
  const [creating, setCreating] = useState(false)

  const sortedGoals = useMemo(() => [...goals].sort(newestFirst), [goals])
  const current = sortedGoals.find((g) => g.id === selectedGoalId) ?? (selectedGoalId === ALL_TASKS ? undefined : sortedGoals[0])
  const selectedKey = current?.id ?? ALL_TASKS

  // Tasks without a (still existing) goal.
  const loose = useMemo(() => tasks.filter((t) => !t.goalId || !goals.some((g) => g.id === t.goalId)), [tasks, goals])
  const visible = useMemo(() => (current ? tasks.filter((t) => t.goalId === current.id) : loose).sort(byOrder), [tasks, loose, current])
  const nextOrder = visible.reduce((m, t) => Math.max(m, t.order), 0) + 1

  const actions = (
    <PageActions>
      <Button size="sm" onClick={() => setCreating(true)}>
        <PlusIcon data-icon="inline-start" /> New goal
      </Button>
    </PageActions>
  )
  const dialog = <NewGoalDialog open={creating} onOpenChange={setCreating} />

  if (!loaded) return <LoadingState label="Loading goals…" className="absolute inset-0" />

  if (!goals.length && !tasks.length) {
    return (
      <div className="absolute inset-0 grid place-items-center p-6">
        {actions}
        <EmptyState
          icon={KanbanSquareIcon}
          title="No goals yet"
          description="Give the team a goal. The Planner breaks it into tasks for you to review, then the Developer builds and QA tests."
          action={
            <Button onClick={() => setCreating(true)}>
              <RocketIcon data-icon="inline-start" /> New goal
            </Button>
          }
        />
        {dialog}
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex">
      {actions}
      <aside className="w-72 shrink-0 border-r bg-sunken/40">
        <GoalList goals={sortedGoals} tasks={tasks} selected={selectedKey} looseCount={loose.length} allKey={ALL_TASKS} onSelect={selectGoal} />
      </aside>

      {/* One scroll for the pane: header, then sticky tabs, then a board that fills the screen below them. */}
      <section className="min-w-0 flex-1 overflow-y-auto" aria-label={current ? `${current.id}: ${current.title}` : "Tasks without a goal"}>
        <div className="space-y-4 px-6 pt-5 pb-4">
          {current?.status === GoalStatus.AwaitingApproval && <ApprovalBanner goal={current} taskCount={visible.length} />}
          {current ? (
            <GoalHeader goal={current} tasks={visible} />
          ) : (
            <div className="flex items-center gap-2">
              <ListTodoIcon className="size-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold tracking-tight">Tasks without a goal</h2>
              <span className="text-sm text-muted-foreground tabular-nums">{loose.length}</span>
            </div>
          )}
        </div>

        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-y bg-background/95 px-6 py-2.5 backdrop-blur">
          {current && <GoalTabs goalId={current.id} />}
          {(!current || goalTab === GoalTab.Tasks) && <QuickAddTask goalId={current?.id} nextOrder={nextOrder} />}
        </div>

        {current && goalTab === GoalTab.Security ? (
          <div className="px-6 py-4">
            <ErrorBoundary label="Security" key={current.id}>
              <GoalSecurityPanel goalId={current.id} />
            </ErrorBoundary>
          </div>
        ) : current && goalTab === GoalTab.Changes ? (
          <div className="flex h-[max(28rem,calc(100svh-11rem))] flex-col px-6 py-4">
            <ErrorBoundary label="Changes" key={current.id}>
              <ChangesPanel goal={current} />
            </ErrorBoundary>
          </div>
        ) : current && goalTab === GoalTab.Timeline ? (
          <div className="px-6 py-4">
            <ErrorBoundary label="Timeline" key={current.id}>
              <GoalTimeline goalId={current.id} />
            </ErrorBoundary>
          </div>
        ) : (
          <div className="flex h-[max(24rem,calc(100svh-11rem))] gap-3 overflow-x-auto px-6 py-4">
            {TASK_COLUMNS.map((col) => (
              <TaskColumn key={col.status} {...col} tasks={visible.filter((t) => t.status === col.status)} />
            ))}
          </div>
        )}
      </section>
      {dialog}
    </div>
  )
}
