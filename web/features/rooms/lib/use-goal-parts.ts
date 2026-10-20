"use client"

import { useMemo } from "react"
import type { Goal } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { goalParts, useRoomStore, type GoalPart } from "./room-store"

/** The repos a goal has work in (empty outside a room). More than one = linked PRs. */
export function useGoalParts(goal: Goal): GoalPart[] {
  const room = useRoomStore((s) => s.room)
  const tasks = useAppStore((s) => s.tasks)
  return useMemo(() => goalParts(goal, tasks, room), [goal, tasks, room])
}
