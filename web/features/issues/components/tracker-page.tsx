"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { BotIcon, CircleCheckBigIcon, ExternalLinkIcon, MoreHorizontalIcon, RotateCwIcon, SearchIcon, SearchXIcon, Settings2Icon, UnplugIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { Goal, TrackerId, TrackerIssue } from "@shared"
import { cn } from "@/lib/utils"
import { trackerApi } from "@/lib/api/intake-endpoints"
import { timeAgo } from "@/lib/time"
import { useNow } from "@/hooks/use-now"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Callout } from "@/components/kit/callout"
import { Dropdown } from "@/components/kit/dropdown"
import { ToneBadge, ToneDot } from "@/components/kit/badge"
import { TONE_CLASS } from "@/components/kit/tone"
import { EmptyState, ErrorState, LoadingState } from "@/components/kit/state-view"
import { PageActions } from "@/components/layout/page-actions"
import { HandoffDialog } from "@/components/shared/handoff-dialog"
import { SelectionBar } from "@/components/shared/selection-bar"
import { GoalBadge } from "@/features/github/components/goal-badge"
import { useGoalsBySource } from "@/features/github/lib/source-goal"
import { CATEGORY_TONE, ISSUE_FIXER, priorityTone, TRACKER_META } from "../lib/meta"
import {
  DEFAULT_TRACKER_FILTERS,
  loadTrackerIssues,
  loadTrackerStatus,
  setTracker,
  setTrackerFilters,
  toggleTrackerSelect,
  useTrackerStore,
} from "../lib/tracker-store"
import { ConnectTracker } from "./connect-tracker"

const REFRESH_MS = 60_000
const SEARCH_DEBOUNCE_MS = 400

export const LinearPage = () => <TrackerPage tracker="linear" />
export const JiraPage = () => <TrackerPage tracker="jira" />

/** Sources → Linear / Jira: open issues grouped by state, each a hand-off away from the team. */
function TrackerPage({ tracker }: { tracker: TrackerId }) {
  const status = useTrackerStore((s) => s[tracker].status)
  const statusError = useTrackerStore((s) => s[tracker].statusError)
  const editing = useTrackerStore((s) => s[tracker].editing)

  useEffect(() => {
    void loadTrackerStatus(tracker)
  }, [tracker])

  if (!status && statusError) return <ErrorState title={`Couldn't reach the ${TRACKER_META[tracker].label} setup`} error={statusError} onRetry={() => void loadTrackerStatus(tracker)} className="h-full" />
  if (!status) return <LoadingState label={`Checking ${TRACKER_META[tracker].label}…`} className="h-full" />
  if (!status.hasToken) return <ConnectTracker key="credentials" tracker={tracker} startAt="credentials" />
  if (!status.config || editing) return <ConnectTracker key="scope" tracker={tracker} startAt="scope" />
  return <IssuesView tracker={tracker} />
}

function IssuesView({ tracker }: { tracker: TrackerId }) {
  const issues = useTrackerStore((s) => s[tracker].issues)
  const states = useTrackerStore((s) => s[tracker].states)
  const fetchedAt = useTrackerStore((s) => s[tracker].fetchedAt)
  const loading = useTrackerStore((s) => s[tracker].loading)
  const error = useTrackerStore((s) => s[tracker].error)
  const selectedIds = useTrackerStore((s) => s[tracker].selected)
  const openId = useTrackerStore((s) => s[tracker].openIssueId)
  const handoffOpen = useTrackerStore((s) => s[tracker].handoffOpen)
  const goalByIssue = useGoalsBySource(tracker)
  const meta = TRACKER_META[tracker]

  useEffect(() => {
    void loadTrackerIssues(tracker)
    const t = setInterval(() => document.visibilityState === "visible" && void loadTrackerIssues(tracker), REFRESH_MS)
    return () => clearInterval(t)
  }, [tracker])

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const picked = useMemo(() => issues.filter((i) => selected.has(i.id)), [issues, selected])
  // Group by state, in the tracker's own order; states without issues are left out.
  const groups = useMemo(() => {
    const order = new Map(states.map((s, i) => [s.name, i]))
    const by = new Map<string, TrackerIssue[]>()
    for (const i of issues) by.set(i.state.name, [...(by.get(i.state.name) ?? []), i])
    return [...by.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
  }, [issues, states])

  return (
    <div className="absolute inset-0 flex flex-col">
      <TrackerActions tracker={tracker} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-6 pt-5 pb-28">
          <TrackerToolbar tracker={tracker} />
          {error && (
            <Callout tone="warning" title="Couldn't refresh issues" action={<Button size="sm" variant="outline" onClick={() => void loadTrackerIssues(tracker, { refresh: true })}>Retry</Button>}>
              <span className="break-words">{error}</span>
            </Callout>
          )}
          {!fetchedAt && (loading || !error) ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : !issues.length && !error ? (
            <NoIssues tracker={tracker} />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{issues.length}</span> {issues.length === 1 ? "issue" : "issues"}. Open one for its description, or select several to hand off together.
              </p>
              {groups.map(([state, list]) => (
                <section key={state} aria-label={state} className="space-y-1.5">
                  <h3 className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                    <ToneDot tone={CATEGORY_TONE[list[0]!.state.category]} />
                    {state}
                    <span className="tabular-nums">{list.length}</span>
                  </h3>
                  <ul className="overflow-hidden rounded-xl border bg-card">
                    {list.map((i) => (
                      <IssueRow key={i.id} tracker={tracker} issue={i} selected={selected.has(i.id)} selecting={selected.size > 0} open={openId === i.id} goal={goalByIssue.get(i.id)} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </div>

      <SelectionBar count={selectedIds.length} noun={["issue", "issues"]} onClear={() => setTracker(tracker, { selected: [] })} onHandoff={() => setTracker(tracker, { handoffOpen: true })} />
      <HandoffDialog
        open={handoffOpen}
        onOpenChange={(o) => setTracker(tracker, { handoffOpen: o })}
        title={picked.length === 1 ? "Hand off issue" : `Hand off ${picked.length} issues`}
        description={`Pick who works on them. Each issue's description and recent comments go along, marked as untrusted data.`}
        items={picked.map((i) => ({ id: i.id, icon: <ToneDot tone={CATEGORY_TONE[i.state.category]} />, ref: i.key, title: i.title }))}
        onRemove={(id) => setTracker(tracker, { selected: selectedIds.filter((x) => x !== id) })}
        form={{
          directContent: `the ${meta.label} issue`,
          newBot: ISSUE_FIXER,
          send: (input) => trackerApi.handoff(tracker, { issueIds: picked.map((i) => i.id), ...input }),
          later: { source: tracker, ids: picked.map((i) => i.id), label: picked.length === 1 ? picked[0]!.key : `${picked.length} issues` },
          onDone: () => setTracker(tracker, { selected: [], handoffOpen: false }),
        }}
      />
    </div>
  )
}

const IssueRow = memo(function IssueRow({ tracker, issue: i, selected, selecting, open, goal }: { tracker: TrackerId; issue: TrackerIssue; selected: boolean; selecting: boolean; open: boolean; goal?: Goal }) {
  const openIt = () => setTracker(tracker, { openIssueId: i.id })
  return (
    <li className={cn("group relative flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-accent/40", selected && "bg-brand/5", open && !selected && "bg-accent/60")}>
      <button type="button" onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? toggleTrackerSelect(tracker, i.id) : openIt())} className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset" aria-label={`Open ${i.key}: ${i.title}`} />
      <Checkbox
        checked={selected}
        onClick={(e) => {
          e.stopPropagation()
          toggleTrackerSelect(tracker, i.id)
        }}
        aria-label={`Select ${i.key}`}
        className={cn("relative bg-surface transition-opacity", !(selected || selecting) && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
      />
      <span className="pointer-events-none relative w-20 shrink-0 truncate font-mono text-xs text-muted-foreground">{i.key}</span>
      <span className="pointer-events-none relative min-w-0 flex-1">
        <span className="block truncate text-sm">{i.title}</span>
        {(i.labels.length > 0 || i.type) && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden">
            {i.type && <span className="text-xs text-muted-foreground">{i.type}</span>}
            {i.labels.slice(0, 3).map((l) => (
              <span key={l} className="truncate rounded-full border px-1.5 text-xs text-muted-foreground">
                {l}
              </span>
            ))}
          </span>
        )}
      </span>
      {i.priority && (
        <span className={cn(TONE_CLASS[priorityTone(i.priority.value)], "pointer-events-none relative hidden shrink-0 text-xs sm:inline", priorityTone(i.priority.value) !== "neutral" ? "tone-text font-medium" : "text-muted-foreground")}>{i.priority.label}</span>
      )}
      {i.assignee && (
        <span className="pointer-events-none relative hidden size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold sm:grid" title={`Assigned to ${i.assignee.name}`}>
          {i.assignee.name
            .split(/\s+/)
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </span>
      )}
      <span className="pointer-events-none relative hidden w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums md:inline">{timeAgo(Date.parse(i.updatedAt))}</span>
      {goal ? (
        <span className="relative shrink-0">
          <GoalBadge goal={goal} />
        </span>
      ) : (
        <Button size="sm" variant="ghost" className="relative h-7 shrink-0 rounded-full px-2.5 text-muted-foreground hover:text-foreground" onClick={openIt} aria-label={`Hand ${i.key} to a bot`}>
          <BotIcon data-icon="inline-start" /> Hand off
        </Button>
      )}
    </li>
  )
})

function TrackerActions({ tracker }: { tracker: TrackerId }) {
  const loading = useTrackerStore((s) => s[tracker].loading)
  const fetchedAt = useTrackerStore((s) => s[tracker].fetchedAt)
  const config = useTrackerStore((s) => s[tracker].status?.config)
  const now = useNow()
  const meta = TRACKER_META[tracker]

  const disconnect = async () => {
    try {
      setTracker(tracker, { status: await trackerApi.disconnect(tracker), issues: [], selected: [], openIssueId: null, details: {}, fetchedAt: 0 })
      toast.success(`${meta.label} disconnected on this machine`, { description: `The ${meta.scope} stays in ${meta.file}.` })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <PageActions>
      <span className="hidden text-xs text-muted-foreground tabular-nums lg:inline">{loading ? "Updating…" : fetchedAt ? `Updated ${timeAgo(fetchedAt, now)}` : ""}</span>
      <Button variant="outline" size="icon-sm" onClick={() => void loadTrackerIssues(tracker, { refresh: true })} disabled={loading} aria-label="Refresh issues">
        <RotateCwIcon className={cn(loading && "animate-spin")} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${meta.label} settings`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {config && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{config.scopeName}</DropdownMenuLabel>}
          {config?.site && (
            <DropdownMenuItem asChild>
              <a href={`https://${config.site}/browse/${config.scopeKey}`} target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> Open in {meta.label}
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setTracker(tracker, { editing: true })}>
            <Settings2Icon /> Change {meta.scope} or sync
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={disconnect}>
            <UnplugIcon /> Disconnect on this machine
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PageActions>
  )
}

function TrackerToolbar({ tracker }: { tracker: TrackerId }) {
  const filters = useTrackerStore((s) => s[tracker].filters)
  const states = useTrackerStore((s) => s[tracker].states)
  const config = useTrackerStore((s) => s[tracker].status?.config)
  const changed = filters.states.length > 0 || filters.mine || filters.closed
  const sync = config?.sync
  const syncOn = !!sync && (!!sync.onStart || !!sync.onPr || sync.commentPr)

  return (
    <div className="flex flex-col gap-2.5">
      <SearchBox tracker={tracker} value={filters.query} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Dropdown<string>
          variant="pill"
          label="State"
          multiple
          active={filters.states.length > 0}
          placeholder={filters.closed ? "All" : "All open"}
          hint="Find a state"
          datas={states.filter((s) => filters.closed || (s.category !== "done" && s.category !== "canceled")).map((s) => ({ value: s.name, label: s.name }))}
          selectedValue={filters.states}
          displayLimit={2}
          onSelect={(v) => setTrackerFilters(tracker, { states: v as string[] })}
        />
        <Dropdown<string>
          variant="pill"
          label="Assignee"
          active={filters.mine}
          showSearch={false}
          datas={[
            { value: "any", label: "Anyone" },
            { value: "me", label: "Me" },
          ]}
          selectedValue={filters.mine ? "me" : "any"}
          onSelect={(v) => setTrackerFilters(tracker, { mine: v === "me" })}
        />
        <Dropdown<string>
          variant="pill"
          label="Show"
          active={filters.closed}
          showSearch={false}
          datas={[
            { value: "open", label: "Open" },
            { value: "all", label: "Open and closed" },
          ]}
          selectedValue={filters.closed ? "all" : "open"}
          onSelect={(v) => setTrackerFilters(tracker, { closed: v === "all" })}
        />
        {changed && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setTrackerFilters(tracker, { ...DEFAULT_TRACKER_FILTERS, query: filters.query })}>
            <XIcon data-icon="inline-start" /> Reset
          </Button>
        )}
        <span className="ml-auto">
          <ToneBadge size="sm" tone={syncOn ? "brand" : "neutral"} title={syncOn ? "Goals from these issues update them; see the setup menu" : "AgentRoom only reads from this tracker"}>
            {syncOn ? "Status sync on" : "Read-only"}
          </ToneBadge>
        </span>
      </div>
    </div>
  )
}

function SearchBox({ tracker, value }: { tracker: TrackerId; value: string }) {
  const [text, setText] = useState(value)
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setText(value)
  }
  useEffect(() => {
    if (text === value) return
    const t = setTimeout(() => setTrackerFilters(tracker, { query: text }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text, value, tracker])

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setTrackerFilters(tracker, { query: text })
          if (e.key === "Escape" && text) setText("")
        }}
        placeholder="Search titles and descriptions"
        aria-label="Search issues"
        className="h-10 rounded-full pl-10 text-sm"
      />
    </div>
  )
}

function NoIssues({ tracker }: { tracker: TrackerId }) {
  const filters = useTrackerStore((s) => s[tracker].filters)
  const filtered = !!filters.query.trim() || filters.states.length > 0 || filters.mine
  return (
    <div className="rounded-2xl border border-dashed">
      <EmptyState
        icon={filtered ? SearchXIcon : CircleCheckBigIcon}
        title={filtered ? "No issues match these filters" : "No open issues"}
        description={filtered ? "Try fewer filters." : "Nothing open in this " + TRACKER_META[tracker].scope + "."}
        action={
          filtered && (
            <Button size="sm" variant="outline" onClick={() => setTrackerFilters(tracker, { ...DEFAULT_TRACKER_FILTERS })}>
              Reset filters
            </Button>
          )
        }
      />
    </div>
  )
}

