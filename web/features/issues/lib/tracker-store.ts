"use client"

import { create } from "zustand"
import type { TrackerId, TrackerIssue, TrackerIssueDetail, TrackerState, TrackerStatus } from "@shared"
import { trackerApi } from "@/lib/api/intake-endpoints"

export interface TrackerFilters {
  query: string
  /** State names; empty = all open. */
  states: string[]
  mine: boolean
  closed: boolean
}

export const DEFAULT_TRACKER_FILTERS: TrackerFilters = { query: "", states: [], mine: false, closed: false }

/** One tracker page's state (Linear and Jira each get their own). */
export interface TrackerPage {
  status: TrackerStatus | null
  statusError: string | null
  /** "Change" from the menu: show the connect flow over a working setup. */
  editing: boolean
  filters: TrackerFilters
  issues: TrackerIssue[]
  states: TrackerState[]
  fetchedAt: number
  loading: boolean
  error: string | null
  selected: string[]
  openIssueId: string | null
  details: Record<string, TrackerIssueDetail>
  detailErrors: Record<string, string>
  handoffOpen: boolean
}

const emptyPage = (): TrackerPage => ({
  status: null,
  statusError: null,
  editing: false,
  filters: DEFAULT_TRACKER_FILTERS,
  issues: [],
  states: [],
  fetchedAt: 0,
  loading: false,
  error: null,
  selected: [],
  openIssueId: null,
  details: {},
  detailErrors: {},
  handoffOpen: false,
})

export const useTrackerStore = create<Record<TrackerId, TrackerPage>>(() => ({ linear: emptyPage(), jira: emptyPage() }))

export function setTracker(id: TrackerId, patch: Partial<TrackerPage>) {
  useTrackerStore.setState((s) => ({ [id]: { ...s[id], ...patch } }) as Partial<Record<TrackerId, TrackerPage>>)
}

export const isConnected = (st: TrackerStatus | null) => !!st?.hasToken && !!st.config

export async function loadTrackerStatus(id: TrackerId) {
  try {
    setTracker(id, { status: await trackerApi.status(id), statusError: null })
  } catch (e) {
    setTracker(id, { statusError: (e as Error).message })
  }
}

/** Both trackers' status, for the sidebar (Linear/Jira show once connected). */
export async function loadTrackerStatuses() {
  try {
    const all = await trackerApi.all()
    setTracker("linear", { status: all.linear, statusError: null })
    setTracker("jira", { status: all.jira, statusError: null })
  } catch {
    // an older server: the pages just stay hidden
  }
}

export async function loadTrackerIssues(id: TrackerId, opts: { refresh?: boolean } = {}) {
  const { filters } = useTrackerStore.getState()[id]
  setTracker(id, { loading: true })
  try {
    const page = await trackerApi.issues(id, { ...filters, refresh: opts.refresh })
    setTracker(id, { issues: page.issues, states: page.states, fetchedAt: Date.now(), error: null })
  } catch (e) {
    setTracker(id, { error: (e as Error).message })
  } finally {
    setTracker(id, { loading: false })
  }
}

export function setTrackerFilters(id: TrackerId, patch: Partial<TrackerFilters>) {
  setTracker(id, { filters: { ...useTrackerStore.getState()[id].filters, ...patch }, selected: [] })
  void loadTrackerIssues(id)
}

export async function loadTrackerDetail(id: TrackerId, issueId: string, force = false) {
  const page = useTrackerStore.getState()[id]
  if (page.details[issueId] && !force) return
  try {
    const d = await trackerApi.issue(id, issueId)
    setTracker(id, { details: { ...useTrackerStore.getState()[id].details, [issueId]: d } })
  } catch (e) {
    setTracker(id, { detailErrors: { ...useTrackerStore.getState()[id].detailErrors, [issueId]: (e as Error).message } })
  }
}

export function toggleTrackerSelect(id: TrackerId, issueId: string) {
  const sel = useTrackerStore.getState()[id].selected
  setTracker(id, { selected: sel.includes(issueId) ? sel.filter((x) => x !== issueId) : [...sel, issueId] })
}

/** The open issue's key for the Inspector switcher, e.g. "ENG-12". */
export function trackerIssueLabel(id: TrackerId, issueId: string): string {
  const p = useTrackerStore.getState()[id]
  return (p.issues.find((i) => i.id === issueId) ?? p.details[issueId]?.issue)?.key ?? "Issue"
}
