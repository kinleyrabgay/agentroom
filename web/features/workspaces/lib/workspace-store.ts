"use client"

import { create } from "zustand"
import type { Goal, WorkspaceRepo, WorkspaceView, Task } from "@shared"
import { contextApi, workspaceApi } from "@/lib/api/endpoints"
import { setContextRepo } from "@/lib/api/client"
import { setContext } from "@/features/context/lib/context-store"

export interface WorkspaceState {
  /** The workspace this server runs, or null in single-project mode. */
  workspace: WorkspaceView | null
  loaded: boolean
  /** Repo in view; null = all repos. */
  repo: string | null
}

export const useWorkspaceStore = create<WorkspaceState>(() => ({ workspace: null, loaded: false, repo: null }))

const storageKey = (workspace: string) => `agentroom.workspace.${workspace}.repo`
let loading: Promise<void> | null = null

export const primaryRepoId = (workspace: WorkspaceView | null): string | undefined => workspace?.repos.find((r) => r.primary)?.id

/** The repo context requests and pushes are about: the one in view, or the primary for "All repos". */
function contextRepoFor(workspace: WorkspaceView | null, repo: string | null): string | null {
  return workspace && repo && repo !== primaryRepoId(workspace) ? repo : null
}

/** Load the workspace once (the top bar does it on start). */
export function loadWorkspace(): Promise<void> {
  if (useWorkspaceStore.getState().loaded) return Promise.resolve()
  loading ??= workspaceApi
    .get()
    .catch(() => null)
    .then((workspace) => {
      let repo: string | null = null
      if (workspace) {
        try {
          const saved = localStorage.getItem(storageKey(workspace.name))
          if (saved && workspace.repos.some((r) => r.id === saved)) repo = saved
        } catch {
          /* storage blocked */
        }
      }
      const scope = contextRepoFor(workspace, repo)
      setContextRepo(scope)
      useWorkspaceStore.setState({ workspace, loaded: true, repo })
      // The first status push was the primary repo's; reload for the remembered repo.
      if (scope) reloadContext()
    })
  return loading
}

/** Drop what the Context page holds and fetch the status of the repo now in scope. */
function reloadContext() {
  setContext({ status: null, graph: null, graphError: null, openModuleId: null, details: {}, detailErrors: {}, impactOn: false, impactFiles: [], impact: null, peek: null })
  contextApi
    .status()
    .then((status) => setContext({ status }))
    .catch((e) => setContext({ graphError: (e as Error).message }))
}

/** Switch the repo in view (null = all repos). The Context page reloads for the new repo. */
export function selectRepo(repo: string | null) {
  const { workspace, repo: prev } = useWorkspaceStore.getState()
  if (!workspace || repo === prev) return
  const before = contextRepoFor(workspace, prev)
  const after = contextRepoFor(workspace, repo)
  useWorkspaceStore.setState({ repo })
  try {
    if (repo) localStorage.setItem(storageKey(workspace.name), repo)
    else localStorage.removeItem(storageKey(workspace.name))
  } catch {
    /* storage blocked */
  }
  setContextRepo(after)
  if (before !== after) reloadContext()
}

/** Live context status is tagged with its repo (unset = primary): apply only the repo in view. */
export function contextPushInView(tag: string | undefined): boolean {
  const { workspace, repo } = useWorkspaceStore.getState()
  if (!workspace) return !tag
  return (tag ?? null) === contextRepoFor(workspace, repo)
}

/** One repo's part of a goal: its branch/folder and PR (the primary repo uses the goal's own fields). */
export interface GoalPart {
  repo: WorkspaceRepo
  worktree?: { path: string; branch: string }
  worktreeWarning?: string
  pr?: { url: string; number?: number }
}

/** The repos a goal has work in, in workspace order (like the server: primary first when it has work). */
export function goalParts(goal: Goal, tasks: Pick<Task, "repo" | "goalId">[], workspace: WorkspaceView | null): GoalPart[] {
  if (!workspace) return []
  const primary = primaryRepoId(workspace)
  const mine = tasks.filter((t) => t.goalId === goal.id)
  const others = new Set<string>(Object.keys(goal.repos ?? {}))
  for (const t of mine) if (t.repo && t.repo !== primary) others.add(t.repo)
  const primaryWork = mine.some((t) => !t.repo || t.repo === primary) || !!goal.pr || !others.size
  return workspace.repos
    .filter((r) => (r.primary ? primaryWork : others.has(r.id)))
    .map((r) => {
      const st = r.primary ? goal : goal.repos?.[r.id]
      return { repo: r, ...(st?.worktree ? { worktree: st.worktree } : {}), ...(st?.worktreeWarning ? { worktreeWarning: st.worktreeWarning } : {}), ...(st?.pr ? { pr: st.pr } : {}) }
    })
}

/** The repo a task changes (unset = the workspace's primary repo). */
export const taskRepo = (task: Pick<Task, "repo">, workspace: WorkspaceView | null): string | undefined => task.repo ?? primaryRepoId(workspace)

/** Board filter: the task is in the repo in view (everything when "All repos"). */
export function inRepoView(task: Pick<Task, "repo">, workspace: WorkspaceView | null, repo: string | null): boolean {
  if (!workspace || !repo) return true
  return taskRepo(task, workspace) === repo
}
