"use client"

import { toast } from "sonner"
import type { GithubItem } from "@shared"
import { githubApi } from "@/lib/api/endpoints"
import { patchItem, setGithub, useGithubStore, SetupState } from "./github-store"

const message = (e: unknown) => (e as Error).message

/** Load the project config (setup vs connected). */
export async function loadProject() {
  try {
    const { project } = await githubApi.get()
    setGithub({ project, setup: project ? SetupState.Connected : SetupState.None, setupError: null })
    return project
  } catch (e) {
    setGithub({ setup: SetupState.Error, setupError: message(e) })
    return null
  }
}

/** Cached board first (instant), then a live refresh. */
export async function loadBoard(refresh: boolean) {
  if (refresh) setGithub({ refreshing: true })
  try {
    const board = await githubApi.items(refresh)
    setGithub({ board, project: board.project, error: board.stale?.reason ?? null })
  } catch (e) {
    setGithub({ error: message(e) })
  } finally {
    if (refresh) setGithub({ refreshing: false })
  }
}

export async function loadDetail(id: string) {
  try {
    const detail = await githubApi.item(id)
    setGithub((s) => ({ details: { ...s.details, [id]: detail } }))
  } catch (e) {
    toast.error(message(e))
  }
}

/** Assign / unassign yourself — optimistic, rolled back if GitHub refuses. */
export async function setAssigned(item: GithubItem, assign: boolean) {
  const viewer = useGithubStore.getState().board?.viewer
  if (!viewer) return toast.error("Couldn't tell who you are on GitHub — try Refresh.")
  const optimistic: GithubItem = {
    ...item,
    assignees: assign ? [...item.assignees.filter((a) => a.login !== viewer.login), viewer] : item.assignees.filter((a) => a.login !== viewer.login),
  }
  patchItem(optimistic)
  try {
    patchItem(await githubApi.assign(item.id, assign))
    toast.success(assign ? "Assigned to you on GitHub" : "Unassigned you on GitHub")
  } catch (e) {
    patchItem(item)
    toast.error(message(e))
  }
}
