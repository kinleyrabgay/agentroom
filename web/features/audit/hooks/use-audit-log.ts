"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { AuditEntry, AuditKind, AuditPage } from "@shared"
import { auditApi } from "@/lib/api/endpoints"
import { AUDIT_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "../lib/meta"

export interface AuditFilters {
  q: string
  kind?: AuditKind
  botId?: string
  goalId?: string
  /** ISO: start from entries older than this (jump to a date). */
  before?: string
}

interface Loaded {
  /** The query these results answer. */
  key: string
  entries: AuditEntry[]
  more: boolean
  error: string | null
}

/** Server-side filtered, paginated audit entries (newest first). Search is debounced. */
export function useAuditLog(filters: AuditFilters) {
  const [q, setQ] = useState(filters.q)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloads, setReloads] = useState(0)
  const latest = useRef("")

  useEffect(() => {
    const t = setTimeout(() => setQ(filters.q), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [filters.q])

  const query = useMemo(
    () => ({ q: q || undefined, kind: filters.kind, botId: filters.botId, goalId: filters.goalId, before: filters.before, limit: AUDIT_PAGE_SIZE }),
    [q, filters.kind, filters.botId, filters.goalId, filters.before]
  )
  const key = `${JSON.stringify(query)}#${reloads}`

  // First page whenever the query changes; results for a stale query are dropped.
  useEffect(() => {
    latest.current = key
    auditApi
      .list(query)
      .then((page: AuditPage) => latest.current === key && setLoaded({ key, entries: page.entries, more: page.more, error: null }))
      .catch((e: Error) => latest.current === key && setLoaded({ key, entries: [], more: false, error: e.message }))
  }, [key, query])

  const current = loaded?.key === key ? loaded : null

  const loadMore = async () => {
    const last = current?.entries.at(-1)
    if (!current || !last) return
    setLoadingMore(true)
    try {
      const page = await auditApi.list({ ...query, before: last.ts })
      if (latest.current === key) setLoaded({ ...current, entries: [...current.entries, ...page.entries], more: page.more })
    } catch (e) {
      if (latest.current === key) setLoaded({ ...current, error: (e as Error).message })
    } finally {
      setLoadingMore(false)
    }
  }

  return {
    entries: current?.entries ?? loaded?.entries ?? [],
    more: current?.more ?? false,
    loading: !current || loadingMore,
    error: current?.error ?? null,
    loadMore,
    reload: () => setReloads((n) => n + 1),
  }
}
