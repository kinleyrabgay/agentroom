"use client"

import { create } from "zustand"
import type { GithubBoard, GithubItem, GithubItemDetail, GithubProjectConfig } from "@shared"
import { ASSIGNEE_STORAGE_KEY, AssigneeFilter } from "../constants"

export const SetupState = { Loading: "loading", None: "none", Connected: "connected", Error: "error" } as const
export type SetupState = (typeof SetupState)[keyof typeof SetupState]

export interface GithubState {
  setup: SetupState
  setupError: string | null
  project: GithubProjectConfig | null
  board: GithubBoard | null
  refreshing: boolean
  /** Last refresh error (the board keeps showing cached data). */
  error: string | null
  // filters
  search: string
  assignee: AssigneeFilter
  label: string | null
  sprint: string | null
  hideEmpty: boolean
  // selection & panels
  selected: string[]
  /** Anchor for shift-click range selection. */
  anchor: string | null
  openItemId: string | null
  details: Record<string, GithubItemDetail>
  handoffOpen: boolean
}

function storedAssignee(): AssigneeFilter {
  try {
    const v = typeof window === "undefined" ? null : window.localStorage.getItem(ASSIGNEE_STORAGE_KEY)
    return (Object.values(AssigneeFilter) as string[]).includes(v ?? "") ? (v as AssigneeFilter) : AssigneeFilter.Mine
  } catch {
    return AssigneeFilter.Mine
  }
}

/** Set the assignee filter and remember it for next time. */
export function setAssignee(assignee: AssigneeFilter) {
  setGithub({ assignee })
  try {
    window.localStorage.setItem(ASSIGNEE_STORAGE_KEY, assignee)
  } catch {
    // storage unavailable (private mode) — the choice just isn't remembered
  }
}

const initial: GithubState = {
  setup: SetupState.Loading,
  setupError: null,
  project: null,
  board: null,
  refreshing: false,
  error: null,
  search: "",
  assignee: storedAssignee(),
  label: null,
  sprint: null,
  hideEmpty: false,
  selected: [],
  anchor: null,
  openItemId: null,
  details: {},
  handoffOpen: false,
}

export const useGithubStore = create<GithubState>(() => initial)
export const setGithub = useGithubStore.setState

/** Replace one item everywhere it is cached (board + detail). */
export function patchItem(item: GithubItem) {
  setGithub((s) => ({
    board: s.board ? { ...s.board, items: s.board.items.map((i) => (i.id === item.id ? item : i)) } : s.board,
    details: s.details[item.id] ? { ...s.details, [item.id]: { ...s.details[item.id], item } } : s.details,
  }))
}

/** Toggle a card; with `range`, select everything between the anchor and this card (in visible order). */
export function toggleSelect(id: string, range: boolean, visibleOrder: string[]) {
  setGithub((s) => {
    if (range && s.anchor) {
      const a = visibleOrder.indexOf(s.anchor)
      const b = visibleOrder.indexOf(id)
      if (a >= 0 && b >= 0) {
        const span = visibleOrder.slice(Math.min(a, b), Math.max(a, b) + 1)
        return { selected: [...new Set([...s.selected, ...span])], anchor: id }
      }
    }
    const on = s.selected.includes(id)
    return { selected: on ? s.selected.filter((x) => x !== id) : [...s.selected, id], anchor: id }
  })
}

export const clearSelection = () => setGithub({ selected: [], anchor: null })
