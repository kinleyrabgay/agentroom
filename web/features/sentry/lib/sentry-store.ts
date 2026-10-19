"use client"

import { create } from "zustand"
import type { SentryIssue, SentryIssueDetail, SentryStatus } from "@shared"
import { DEFAULT_FILTERS, FILTERS_STORAGE_KEY, type SentryFilters } from "../constants"

/** Where the page is: still loading, needs a token, needs org/projects, or showing issues. */
export const SentrySetup = { Loading: "loading", NeedsToken: "needs-token", NeedsConfig: "needs-config", Connected: "connected", Error: "error" } as const
export type SentrySetup = (typeof SentrySetup)[keyof typeof SentrySetup]

export interface SentryState {
  setup: SentrySetup
  setupError: string | null
  status: SentryStatus | null
  /** "Change" from the header: show the connect flow over a working setup. */
  editing: boolean
  filters: SentryFilters
  issues: SentryIssue[]
  nextCursor: string | null
  /** Pages loaded; auto-refresh pauses after "Load more" so the list doesn't jump. */
  pages: number
  /** ms epoch of the last successful load; 0 = never. */
  fetchedAt: number
  loading: boolean
  loadingMore: boolean
  /** Last load error (cached issues stay on screen). */
  error: string | null
  selected: string[]
  anchor: string | null
  openIssueId: string | null
  details: Record<string, SentryIssueDetail>
  detailErrors: Record<string, string>
  handoffOpen: boolean
}

function storedFilters(): SentryFilters {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(FILTERS_STORAGE_KEY)
    return raw ? { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<SentryFilters>) } : DEFAULT_FILTERS
  } catch {
    return DEFAULT_FILTERS
  }
}

export function rememberFilters(filters: SentryFilters) {
  try {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // storage unavailable (private mode): filters just aren't remembered
  }
}

export const useSentryStore = create<SentryState>(() => ({
  setup: SentrySetup.Loading,
  setupError: null,
  status: null,
  editing: false,
  filters: storedFilters(),
  issues: [],
  nextCursor: null,
  pages: 0,
  fetchedAt: 0,
  loading: false,
  loadingMore: false,
  error: null,
  selected: [],
  anchor: null,
  openIssueId: null,
  details: {},
  detailErrors: {},
  handoffOpen: false,
}))
export const setSentry = useSentryStore.setState

/** Toggle an issue; with `range`, select everything between the anchor and it (in list order). */
export function toggleSelect(id: string, range: boolean, order: string[]) {
  setSentry((s) => {
    if (range && s.anchor) {
      const a = order.indexOf(s.anchor)
      const b = order.indexOf(id)
      if (a >= 0 && b >= 0) return { selected: [...new Set([...s.selected, ...order.slice(Math.min(a, b), Math.max(a, b) + 1)])], anchor: id }
    }
    const on = s.selected.includes(id)
    return { selected: on ? s.selected.filter((x) => x !== id) : [...s.selected, id], anchor: id }
  })
}

export const clearSelection = () => setSentry({ selected: [], anchor: null })
