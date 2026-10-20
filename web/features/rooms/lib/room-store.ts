"use client"

import { create } from "zustand"
import type { Goal, RoomRepo, RoomView, Task } from "@shared"
import { contextApi, roomApi } from "@/lib/api/endpoints"
import { setContextRepo } from "@/lib/api/client"
import { setContext } from "@/features/context/lib/context-store"

export interface RoomState {
  /** The room this server runs, or null in single-project mode. */
  room: RoomView | null
  loaded: boolean
  /** Repo in view; null = all repos. */
  repo: string | null
}

export const useRoomStore = create<RoomState>(() => ({ room: null, loaded: false, repo: null }))

const storageKey = (room: string) => `agentroom.room.${room}.repo`
let loading: Promise<void> | null = null

export const primaryRepoId = (room: RoomView | null): string | undefined => room?.repos.find((r) => r.primary)?.id

/** The repo context requests and pushes are about: the one in view, or the primary for "All repos". */
function contextRepoFor(room: RoomView | null, repo: string | null): string | null {
  return room && repo && repo !== primaryRepoId(room) ? repo : null
}

/** Load the room once (the top bar does it on start). */
export function loadRoom(): Promise<void> {
  if (useRoomStore.getState().loaded) return Promise.resolve()
  loading ??= roomApi
    .get()
    .catch(() => null)
    .then((room) => {
      let repo: string | null = null
      if (room) {
        try {
          const saved = localStorage.getItem(storageKey(room.name))
          if (saved && room.repos.some((r) => r.id === saved)) repo = saved
        } catch {
          /* storage blocked */
        }
      }
      const scope = contextRepoFor(room, repo)
      setContextRepo(scope)
      useRoomStore.setState({ room, loaded: true, repo })
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
  const { room, repo: prev } = useRoomStore.getState()
  if (!room || repo === prev) return
  const before = contextRepoFor(room, prev)
  const after = contextRepoFor(room, repo)
  useRoomStore.setState({ repo })
  try {
    if (repo) localStorage.setItem(storageKey(room.name), repo)
    else localStorage.removeItem(storageKey(room.name))
  } catch {
    /* storage blocked */
  }
  setContextRepo(after)
  if (before !== after) reloadContext()
}

/** Live context status is tagged with its repo (unset = primary): apply only the repo in view. */
export function contextPushInView(tag: string | undefined): boolean {
  const { room, repo } = useRoomStore.getState()
  if (!room) return !tag
  return (tag ?? null) === contextRepoFor(room, repo)
}

/** One repo's part of a goal: its branch/folder and PR (the primary repo uses the goal's own fields). */
export interface GoalPart {
  repo: RoomRepo
  worktree?: { path: string; branch: string }
  worktreeWarning?: string
  pr?: { url: string; number?: number }
}

/** The repos a goal has work in, in room order (like the server: primary first when it has work). */
export function goalParts(goal: Goal, tasks: Pick<Task, "repo" | "goalId">[], room: RoomView | null): GoalPart[] {
  if (!room) return []
  const primary = primaryRepoId(room)
  const mine = tasks.filter((t) => t.goalId === goal.id)
  const others = new Set<string>(Object.keys(goal.repos ?? {}))
  for (const t of mine) if (t.repo && t.repo !== primary) others.add(t.repo)
  const primaryWork = mine.some((t) => !t.repo || t.repo === primary) || !!goal.pr || !others.size
  return room.repos
    .filter((r) => (r.primary ? primaryWork : others.has(r.id)))
    .map((r) => {
      const st = r.primary ? goal : goal.repos?.[r.id]
      return { repo: r, ...(st?.worktree ? { worktree: st.worktree } : {}), ...(st?.worktreeWarning ? { worktreeWarning: st.worktreeWarning } : {}), ...(st?.pr ? { pr: st.pr } : {}) }
    })
}

/** The repo a task changes (unset = the room's primary repo). */
export const taskRepo = (task: Pick<Task, "repo">, room: RoomView | null): string | undefined => task.repo ?? primaryRepoId(room)

/** Board filter: the task is in the repo in view (everything when "All repos"). */
export function inRepoView(task: Pick<Task, "repo">, room: RoomView | null, repo: string | null): boolean {
  if (!room || !repo) return true
  return taskRepo(task, room) === repo
}
