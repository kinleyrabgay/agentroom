"use client"

import { useState, type ReactNode } from "react"
import type { Goal } from "@shared"
import { Segmented } from "@/components/kit/segmented"
import { useWorkspaceStore } from "../lib/workspace-store"
import { useGoalParts } from "../lib/use-goal-parts"

/**
 * Multi-repo workspaces: when a goal has work in several repos, a switch above its per-repo content
 * (Changes). `children` gets the repo id, or undefined for the primary repo.
 */
export function GoalRepoTabs({ goal, children }: { goal: Goal; children: (repo: string | undefined) => ReactNode }) {
  const parts = useGoalParts(goal)
  const inView = useWorkspaceStore((s) => s.repo)
  const [picked, setPicked] = useState<string | null>(null)
  if (parts.length < 2) return <>{children(undefined)}</>
  const current = parts.find((p) => p.repo.id === picked) ?? parts.find((p) => p.repo.id === inView) ?? parts[0]!
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Segmented
          size="sm"
          aria-label="Repo"
          value={current.repo.id}
          onChange={setPicked}
          options={parts.map((p) => ({ value: p.repo.id, label: p.repo.name }))}
        />
        <span className="truncate text-xs text-muted-foreground">
          {current.worktree ? <span className="font-mono">{current.worktree.branch}</span> : (current.worktreeWarning ?? "No folder yet")}
          {current.pr ? " · PR open" : ""}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children(current.repo.primary ? undefined : current.repo.id)}</div>
    </div>
  )
}
