"use client"

import { useMemo, useState } from "react"
import { KanbanSquareIcon, RocketIcon } from "lucide-react"
import { GoalStatus } from "@shared"
import { ALL_TASKS, useAppStore } from "@/lib/store/app-store"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { TASK_COLUMNS } from "../constants"
import { byOrder, newestFirst } from "../lib/goal-phase"
import { ApprovalBanner } from "./approval-banner"
import { TaskColumn } from "./task-column"
import { GoalBar } from "./goal-bar"
import { GoalHeader } from "./goal-header"
import { QuickAddTask } from "./quick-add-task"
import { TaskSheet } from "./task-sheet/task-sheet"
import { NewGoalDialog } from "./new-goal-dialog"

/** Tasks view: pick a goal, review its plan, and follow tasks from To do to Done. */
export function TaskBoard() {
  const goals = useAppStore((s) => s.goals)
  const tasks = useAppStore((s) => s.tasks)
  const selectedGoalId = useAppStore((s) => s.selectedGoalId)
  const selectGoal = useAppStore((s) => s.selectGoal)
  const [creating, setCreating] = useState(false)

  const sortedGoals = useMemo(() => [...goals].sort(newestFirst), [goals])
  const current =
    sortedGoals.find((g) => g.id === selectedGoalId) ??
    (selectedGoalId === ALL_TASKS ? undefined : sortedGoals[0])
  const selectedKey = current?.id ?? ALL_TASKS

  // Tasks without a (still existing) goal live under "Other tasks".
  const loose = useMemo(
    () =>
      tasks.filter((t) => !t.goalId || !goals.some((g) => g.id === t.goalId)),
    [tasks, goals]
  )
  const visible = useMemo(
    () =>
      (current ? tasks.filter((t) => t.goalId === current.id) : loose).sort(
        byOrder
      ),
    [tasks, loose, current]
  )
  const looseCount = loose.length
  const nextOrder = visible.reduce((m, t) => Math.max(m, t.order), 0) + 1

  if (!goals.length && !tasks.length) {
    return (
      <div className="absolute inset-0 grid place-items-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KanbanSquareIcon />
            </EmptyMedia>
            <EmptyTitle>No goals yet</EmptyTitle>
            <EmptyDescription>
              Give the team a goal. The Planner breaks it into tasks for you to
              review; then the Developer builds and QA tests.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <button
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <RocketIcon className="size-4" /> New goal
            </button>
          </EmptyContent>
        </Empty>
        <NewGoalDialog open={creating} onOpenChange={setCreating} />
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex flex-col gap-3 p-4">
      <GoalBar
        goals={sortedGoals}
        selected={selectedKey}
        looseCount={looseCount}
        onSelect={selectGoal}
        allKey={ALL_TASKS}
      />

      <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto">
        {current?.status === GoalStatus.AwaitingApproval && (
          <ApprovalBanner goal={current} taskCount={visible.length} />
        )}
        {current && <GoalHeader goal={current} tasks={visible} />}
      </div>

      <div className="flex items-center gap-2">
        <QuickAddTask goalId={current?.id} nextOrder={nextOrder} />
      </div>

      <div className="grid min-h-0 flex-1 auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-3 overflow-x-auto">
        {TASK_COLUMNS.map((col) => (
          <TaskColumn
            key={col.status}
            {...col}
            tasks={visible.filter((t) => t.status === col.status)}
          />
        ))}
      </div>

      <TaskSheet />
    </div>
  )
}
