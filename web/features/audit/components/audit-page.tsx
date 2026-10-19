"use client"

import { useMemo, useState } from "react"
import { DownloadIcon, Loader2Icon, RefreshCwIcon, ScrollTextIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, ErrorState } from "@/components/kit/state-view"
import { PageActions } from "@/components/layout/page-actions"
import { useNow } from "@/hooks/use-now"
import { useAuditLog } from "../hooks/use-audit-log"
import { downloadJsonl } from "../lib/export"
import { AuditFilterBar, type FilterState } from "./audit-filters"
import { AuditRow } from "./audit-row"

/** Searchable record of every command, write, push and approval — and who decided. */
export function AuditPage() {
  const [filters, setFilters] = useState<FilterState>({ q: "" })
  const { entries, more, loading, error, loadMore, reload } = useAuditLog(filters)
  const now = useNow()
  // "Decided by" isn't a server filter; narrow the loaded page here.
  const shown = useMemo(() => (filters.actor ? entries.filter((e) => e.actor.type === filters.actor) : entries), [entries, filters.actor])
  const filtered = !!(filters.q || filters.kind || filters.botId || filters.goalId || filters.actor || filters.before)

  return (
    <div className="absolute inset-0 flex flex-col">
      <PageActions>
        <Button size="sm" variant="outline" onClick={reload} disabled={loading}>
          <RefreshCwIcon className={loading ? "animate-spin" : undefined} data-icon="inline-start" /> Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadJsonl(shown)} disabled={!shown.length}>
          <DownloadIcon data-icon="inline-start" /> Export JSONL
        </Button>
      </PageActions>
      <div className="border-b px-6 py-3">
        <AuditFilterBar value={filters} onChange={setFilters} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState title="Couldn't load the audit log" error={error} onRetry={reload} />
        ) : loading && !entries.length ? (
          <div className="space-y-2 px-6 py-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !shown.length ? (
          <EmptyState
            icon={ScrollTextIcon}
            title={filtered ? "No matching entries" : "Nothing recorded yet"}
            description={
              filtered
                ? "Try a different search or clear the filters."
                : "Commands, file writes, pushes and approvals show up here as your bots work. Stored locally in .agentroom/runs/audit.jsonl."
            }
          />
        ) : (
          <>
            <ul className="mx-auto max-w-7xl text-sm">
              {shown.map((e) => (
                <AuditRow key={e.id} entry={e} now={now} />
              ))}
            </ul>
            {more && (
              <div className="flex justify-center py-4">
                <Button size="sm" variant="outline" onClick={loadMore} disabled={loading}>
                  {loading && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
                  Load older entries
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
