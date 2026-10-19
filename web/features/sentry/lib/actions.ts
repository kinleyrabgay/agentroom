"use client"

import type { SentryIssueQuery } from "@shared"
import { sentryApi } from "@/lib/api/endpoints"
import type { SentryFilters } from "../constants"
import { rememberFilters, SentrySetup, setSentry, useSentryStore } from "./sentry-store"

/** A server error about the token means: show the connect screen. */
export const isTokenError = (message: string) => /token|unauthori[sz]ed|401|403/i.test(message)

export async function loadStatus() {
  try {
    const status = await sentryApi.status()
    setSentry({
      status,
      setupError: null,
      setup: !status.hasToken ? SentrySetup.NeedsToken : !status.config ? SentrySetup.NeedsConfig : SentrySetup.Connected,
    })
  } catch (e) {
    setSentry({ setup: SentrySetup.Error, setupError: (e as Error).message })
  }
}

function toQuery(f: SentryFilters, cursor?: string): SentryIssueQuery {
  return {
    ...(f.query.trim() ? { query: f.query.trim() } : {}),
    ...(f.projects.length ? { projects: f.projects } : {}),
    ...(f.environment ? { environment: f.environment } : {}),
    status: f.status,
    ...(f.level ? { level: f.level } : {}),
    assigned: f.assigned,
    sort: f.sort,
    period: f.period,
    ...(cursor ? { cursor } : {}),
  }
}

let seq = 0

/** Load the first page for the current filters (or the next page with `more`). Stale answers are dropped. */
export async function loadIssues({ more = false }: { more?: boolean } = {}) {
  const s = useSentryStore.getState()
  if (s.setup !== SentrySetup.Connected) return
  if (more && (!s.nextCursor || s.loadingMore)) return
  const mine = ++seq
  setSentry(more ? { loadingMore: true } : { loading: true })
  try {
    const page = await sentryApi.issues(toQuery(s.filters, more ? (s.nextCursor ?? undefined) : undefined))
    if (mine !== seq) return
    setSentry((cur) => ({
      issues: more ? [...cur.issues, ...page.issues.filter((i) => !cur.issues.some((x) => x.id === i.id))] : page.issues,
      nextCursor: page.nextCursor,
      pages: more ? cur.pages + 1 : 1,
      fetchedAt: Date.parse(page.fetchedAt) || Date.now(),
      error: null,
      // Keep only selections that are still on screen.
      selected: more ? cur.selected : cur.selected.filter((id) => page.issues.some((i) => i.id === id)),
    }))
  } catch (e) {
    if (mine !== seq) return
    const message = (e as Error).message
    if (isTokenError(message)) setSentry({ setup: SentrySetup.NeedsToken, setupError: message })
    else setSentry({ error: message })
  } finally {
    if (mine === seq) setSentry({ loading: false, loadingMore: false })
  }
}

/** Change filters, remember them, reload from the first page. */
export function setFilters(patch: Partial<SentryFilters>) {
  const filters = { ...useSentryStore.getState().filters, ...patch }
  rememberFilters(filters)
  setSentry({ filters, nextCursor: null })
  void loadIssues()
}

export async function loadDetail(id: string) {
  try {
    const detail = await sentryApi.issue(id)
    setSentry((s) => ({ details: { ...s.details, [id]: detail }, detailErrors: { ...s.detailErrors, [id]: "" } }))
  } catch (e) {
    setSentry((s) => ({ detailErrors: { ...s.detailErrors, [id]: (e as Error).message } }))
  }
}
