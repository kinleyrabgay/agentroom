"use client"

import { useCallback, useMemo } from "react"
import { CircleCheckBigIcon, Loader2Icon, SearchXIcon } from "lucide-react"
import { sentryApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/kit/callout"
import { EmptyState, ErrorState, LoadingState } from "@/components/kit/state-view"
import { ToneDot } from "@/components/kit/badge"
import { HandoffDialog } from "@/components/shared/handoff-dialog"
import { SelectionBar } from "@/components/shared/selection-bar"
import { useGoalsBySource } from "@/features/github/lib/source-goal"
import { BUG_FIXER, DEFAULT_FILTERS, levelMeta } from "../constants"
import { useSentryIssues } from "../hooks/use-sentry-issues"
import { loadIssues, loadStatus, setFilters } from "../lib/actions"
import { clearSelection, SentrySetup, setSentry, toggleSelect, useSentryStore } from "../lib/sentry-store"
import { ConnectSentry } from "./connect-sentry"
import { IssueCard, shortRef } from "./issue-card"
import { SentryActions, SentryToolbar } from "./issues-toolbar"

/** Workspace → Sentry: the project's errors, filterable, each one a hand-off away from a bot. Details open in the Inspector. */
export function SentryPage() {
  useSentryIssues()
  const setup = useSentryStore((s) => s.setup)
  const setupError = useSentryStore((s) => s.setupError)
  const editing = useSentryStore((s) => s.editing)

  if (setup === SentrySetup.Loading) return <LoadingState label="Checking Sentry…" className="h-full" />
  if (setup === SentrySetup.Error) {
    return <ErrorState title="Couldn't reach the Sentry setup" error={setupError ?? "Unknown error"} onRetry={() => void loadStatus()} className="h-full" />
  }
  if (setup === SentrySetup.NeedsToken) return <ConnectSentry startAt="token" />
  if (setup === SentrySetup.NeedsConfig || editing) return <ConnectSentry startAt="config" />
  return <IssuesView />
}

function IssuesView() {
  const issues = useSentryStore((s) => s.issues)
  const fetchedAt = useSentryStore((s) => s.fetchedAt)
  const loading = useSentryStore((s) => s.loading)
  const loadingMore = useSentryStore((s) => s.loadingMore)
  const nextCursor = useSentryStore((s) => s.nextCursor)
  const error = useSentryStore((s) => s.error)
  const status = useSentryStore((s) => s.filters.status)
  const selectedIds = useSentryStore((s) => s.selected)
  const openId = useSentryStore((s) => s.openIssueId)
  const handoffOpen = useSentryStore((s) => s.handoffOpen)
  const goalByIssue = useGoalsBySource("sentry")

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const order = useMemo(() => issues.map((i) => i.id), [issues])
  const picked = useMemo(() => issues.filter((i) => selected.has(i.id)), [issues, selected])

  const onToggle = useCallback((id: string, range: boolean) => toggleSelect(id, range, order), [order])
  const onOpen = useCallback((id: string) => setSentry({ openIssueId: id }), [])
  const onFix = useCallback((id: string) => {
    setSentry({ openIssueId: id })
    // Wait for the Inspector to render the issue, then jump to the hand-off form.
    setTimeout(() => document.getElementById("sentry-handoff")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300)
  }, [])

  const firstLoad = !fetchedAt && (loading || !error)

  return (
    <div className="absolute inset-0 flex flex-col">
      <SentryActions />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="@container mx-auto max-w-7xl space-y-4 px-6 pt-5 pb-28">
          <SentryToolbar />

          {error && (
            <Callout
              tone="warning"
              title="Couldn't refresh issues"
              action={
                <Button size="sm" variant="outline" onClick={() => void loadIssues()}>
                  Retry
                </Button>
              }
            >
              <span className="break-words">{error}</span>
            </Callout>
          )}

          {firstLoad ? (
            <div className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-56 w-full rounded-xl" />
              ))}
            </div>
          ) : issues.length === 0 && !error ? (
            <NoIssues unresolvedOnly={status === "unresolved"} />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{issues.length}</span> {issues.length === 1 ? "issue" : "issues"}
                {nextCursor ? " loaded" : ""}. Open one for its stack trace, or select several to hand off together.
              </p>
              <ul className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
                {issues.map((i) => (
                  <IssueCard
                    key={i.id}
                    issue={i}
                    selected={selected.has(i.id)}
                    selecting={selected.size > 0}
                    open={openId === i.id}
                    goal={goalByIssue.get(i.id)}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    onFix={onFix}
                  />
                ))}
              </ul>
              {nextCursor && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" size="sm" onClick={() => void loadIssues({ more: true })} disabled={loadingMore}>
                    {loadingMore && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <SelectionBar count={selectedIds.length} noun={["issue", "issues"]} onClear={clearSelection} onHandoff={() => setSentry({ handoffOpen: true })} />
      <HandoffDialog
        open={handoffOpen}
        onOpenChange={(o) => setSentry({ handoffOpen: o })}
        title={picked.length === 1 ? "Hand off issue" : `Hand off ${picked.length} issues`}
        description="Pick who fixes them. Each issue's stack trace goes along."
        items={picked.map((i) => ({ id: i.id, icon: <ToneDot tone={levelMeta(i.level).tone} />, ref: shortRef(i.shortId), title: i.type ?? i.title }))}
        onRemove={(id) => setSentry({ selected: selectedIds.filter((x) => x !== id) })}
        form={{
          directContent: "the stack traces",
          newBot: BUG_FIXER,
          send: (input) => sentryApi.handoff({ issueIds: picked.map((i) => i.id), ...input }),
          later: { source: "sentry", ids: picked.map((i) => i.id), label: picked.length === 1 ? picked[0]!.shortId : `${picked.length} issues` },
          onDone: () => {
            clearSelection()
            setSentry({ handoffOpen: false })
          },
        }}
      />
    </div>
  )
}

function NoIssues({ unresolvedOnly }: { unresolvedOnly: boolean }) {
  const filters = useSentryStore((s) => s.filters)
  const filtered = !!filters.query.trim() || filters.projects.length > 0 || !!filters.level || filters.assigned !== "any" || !!filters.environment
  return (
    <div className="rounded-2xl border border-dashed">
      <EmptyState
        icon={filtered ? SearchXIcon : CircleCheckBigIcon}
        title={filtered ? "No issues match these filters" : unresolvedOnly ? "No unresolved issues" : "No issues in this period"}
        description={filtered ? "Try a wider period or reset some filters." : "Nothing is breaking right now. New errors show up here within a minute."}
        action={
          filtered && (
            <Button size="sm" variant="outline" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>
              Reset filters
            </Button>
          )
        }
      />
    </div>
  )
}
