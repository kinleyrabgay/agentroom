"use client"

import { useMemo } from "react"
import type { Goal } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { goalParts, useWorkspaceStore, type GoalPart } from "./workspace-store"

/** The repos a goal has work in (empty outside a workspace). More than one = linked PRs. */
export function useGoalParts(goal: Goal): GoalPart[] {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const tasks = useAppStore((s) => s.tasks)
  return useMemo(() => goalParts(goal, tasks, workspace), [goal, tasks, workspace])
}
