"use client"

import { useMemo, useState } from "react"
import { DownloadIcon, Loader2Icon, RefreshCwIcon, ScrollTextIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
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
  const filtered = !!(filters.q || filters.kind || filters.botId || filters.goalId || filters.actor)

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="space-y-3 border-b px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-muted-foreground">
            Every shell command, file write, push and approval, with who decided. Stored locally in{" "}
            <code className="font-mono text-xs">.agentroom/runs/audit.jsonl</code>.
          </p>
          <Button size="sm" variant="ghost" onClick={reload} disabled={loading} aria-label="Refresh">
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadJsonl(shown)} disabled={!shown.length}>
            <DownloadIcon data-icon="inline-start" /> Export JSONL
          </Button>
        </div>
        <AuditFilterBar value={filters} onChange={setFilters} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="flex items-center gap-2 px-6 py-6 text-sm text-destructive">
            <TriangleAlertIcon className="size-4" /> Couldn&apos;t load the audit log: {error}
          </div>
        ) : loading && !entries.length ? (
          <div className="space-y-2 px-6 py-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !shown.length ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScrollTextIcon />
              </EmptyMedia>
              <EmptyTitle>{filtered ? "No matching entries" : "Nothing recorded yet"}</EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? "Try a different search or clear the filters."
                  : "Commands, file writes, pushes and approvals show up here as your bots work."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ul className="text-sm">
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
