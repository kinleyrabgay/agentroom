"use client"

import { FolderGit2Icon } from "lucide-react"
import type { Goal, Task } from "@shared"
import { cn } from "@/lib/utils"
import { ToneBadge } from "@/components/kit/badge"
import { taskRepo, useRoomStore } from "../lib/room-store"
import { useGoalParts } from "../lib/use-goal-parts"

/** The repo a task (or a goal's part) is in. Shown only in a multi-repo room. */
export function RepoBadge({ task, repo, className }: { task?: Pick<Task, "repo">; repo?: string; className?: string }) {
  const room = useRoomStore((s) => s.room)
  if (!room) return null
  const id = repo ?? (task ? taskRepo(task, room) : undefined)
  const r = room.repos.find((x) => x.id === id)
  if (!r) return null
  return (
    <ToneBadge size="sm" icon={FolderGit2Icon} className={cn("font-mono font-normal", className)} title={`${r.root}${r.primary ? " (primary)" : ""}`}>
      {r.name}
    </ToneBadge>
  )
}

/** Repos a goal has work in, as badges (room only, and only when it spans more than one). */
export function GoalRepoBadges({ goal, className }: { goal: Goal; className?: string }) {
  const parts = useGoalParts(goal)
  if (parts.length < 2) return null
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)} aria-label={`Spans ${parts.length} repos`}>
      {parts.map((p) => (
        <RepoBadge key={p.repo.id} repo={p.repo.id} />
      ))}
    </span>
  )
}
