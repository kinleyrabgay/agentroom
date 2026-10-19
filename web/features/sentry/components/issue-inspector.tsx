"use client"

import { useEffect, useState } from "react"
import { ChevronRightIcon, ExternalLinkIcon, GlobeIcon, ListTreeIcon, TagIcon, ZapIcon } from "lucide-react"
import type { Goal, SentryBreadcrumb, SentryIssue, SentryIssueDetail } from "@shared"
import { cn } from "@/lib/utils"
import { sentryApi } from "@/lib/api/endpoints"
import { timeAgo } from "@/lib/time"
import { DetailSection, HandoffSection, InspectorPanel, JumpToHandoff } from "@/components/shared/inspector-panel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToneBadge, ToneDot } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { PropertyGrid } from "@/components/kit/property-grid"
import { TONE_CLASS, type Tone } from "@/components/kit/tone"
import { GoalBadge } from "@/features/github/components/goal-badge"
import { useGoalsBySource } from "@/features/github/lib/source-goal"
import { BUG_FIXER, levelMeta, PRIORITY_TONE, SUBSTATUS_META } from "../constants"
import { loadDetail } from "../lib/actions"
import { compact } from "../lib/format"
import { setSentry, useSentryStore } from "../lib/sentry-store"
import { shortRef } from "./issue-card"
import { StackTrace } from "./stack-trace"

const BREADCRUMBS_SHOWN = 30
const HANDOFF_ID = "sentry-handoff"

/** Short name for the Inspector switch: the short id's suffix, e.g. "4X". */
export function sentryIssueLabel(id: string): string {
  const s = useSentryStore.getState()
  const issue = s.issues.find((i) => i.id === id) ?? s.details[id]?.issue
  return issue ? shortRef(issue.shortId) : "Issue"
}

/** Issue details in the Inspector: numbers, stack trace, where it happened, breadcrumbs, tags; hand-off at the bottom. */
export function SentryIssueInspector({ id }: { id: string }) {
  const issues = useSentryStore((s) => s.issues)
  const detail = useSentryStore((s) => s.details[id])
  const detailError = useSentryStore((s) => s.detailErrors[id])
  const issue = issues.find((i) => i.id === id) ?? detail?.issue
  const goal = useGoalsBySource("sentry").get(id)

  useEffect(() => {
    void loadDetail(id)
  }, [id])

  const close = () => setSentry({ openIssueId: null })

  if (!issue) {
    return detailError ? (
      <div className="p-5">
        <Callout tone="danger" title="Couldn't load this issue" action={<Button size="sm" variant="outline" onClick={close}>Close</Button>}>
          {detailError}
        </Callout>
      </div>
    ) : (
      <div className="space-y-3 p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <InspectorPanel
      label={`Sentry issue ${issue.shortId}`}
      onClose={close}
      refLine={<RefLine issue={issue} goal={goal} />}
      title={<span className="font-mono text-lg">{issue.type ?? issue.title}</span>}
      subtitle={
        <>
          {issue.value && <p className="text-sm break-words text-foreground/80">{issue.value}</p>}
          {issue.culprit && <p className="truncate font-mono text-xs text-muted-foreground">{issue.culprit}</p>}
        </>
      }
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <a href={issue.permalink} target="_blank" rel="noreferrer noopener">
              <ExternalLinkIcon data-icon="inline-start" /> Open in Sentry
            </a>
          </Button>
          <JumpToHandoff targetId={HANDOFF_ID} />
        </>
      }
    >
      <div className="space-y-6 p-5">
        <Stats issue={issue} detail={detail} />
        {detailError && !detail ? (
          <Callout tone="danger" title="Couldn't load the latest event">
            {detailError}
          </Callout>
        ) : !detail ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : (
          <EventSections detail={detail} />
        )}

        <HandoffSection
          id={HANDOFF_ID}
          description="The error, stack trace, breadcrumbs and tags go along, marked as untrusted data. Add what only you know."
          form={{
            count: 1,
            directContent: "the stack trace",
            newBot: BUG_FIXER,
            send: (input) => sentryApi.handoff({ issueIds: [issue.id], ...input }),
            later: { source: "sentry", ids: [issue.id], label: issue.shortId },
            onDone: close,
          }}
        />
      </div>
    </InspectorPanel>
  )
}

function RefLine({ issue: i, goal }: { issue: SentryIssue; goal?: Goal }) {
  const level = levelMeta(i.level)
  const sub = i.substatus ? SUBSTATUS_META[i.substatus] : undefined
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="rounded-md border bg-sunken px-1.5 py-0.5 font-mono text-xs font-medium text-foreground" title={i.shortId}>
        {shortRef(i.shortId)}
      </span>
      <span className="mr-1 max-w-48 truncate">{i.project.name || i.project.slug}</span>
      <ToneBadge tone={level.tone} size="sm" dot>
        {level.label}
      </ToneBadge>
      <ToneBadge tone="neutral" size="sm" className="capitalize">
        {i.status}
      </ToneBadge>
      {sub && (
        <ToneBadge tone={sub.tone} size="sm">
          {sub.label}
        </ToneBadge>
      )}
      {i.unhandled && (
        <ToneBadge tone="danger" size="sm" icon={ZapIcon}>
          Unhandled
        </ToneBadge>
      )}
      {goal && <GoalBadge goal={goal} />}
    </div>
  )
}

function Stats({ issue: i, detail }: { issue: SentryIssue; detail?: SentryIssueDetail }) {
  const ev = detail?.event
  const pending = detail ? undefined : "…"
  return (
    <PropertyGrid
      className="rounded-xl border bg-sunken/50 p-4 sm:grid-cols-4"
      items={[
        { label: "Events", value: <span className="tabular-nums">{compact(i.count)}</span> },
        { label: "Users", value: <span className="tabular-nums">{compact(i.userCount)}</span> },
        { label: "First seen", value: <span title={new Date(i.firstSeen).toLocaleString()}>{timeAgo(Date.parse(i.firstSeen))}</span> },
        { label: "Last seen", value: <span title={new Date(i.lastSeen).toLocaleString()}>{timeAgo(Date.parse(i.lastSeen))}</span> },
        {
          label: "Release",
          value: ev?.release ? (
            <span className="font-mono text-[13px]" title={ev.release}>
              {ev.release}
            </span>
          ) : (
            pending
          ),
        },
        { label: "Environment", value: ev?.environment ?? pending },
        {
          label: "Priority",
          value: i.priority ? <span className={cn(TONE_CLASS[PRIORITY_TONE[i.priority] ?? "neutral"], "tone-text capitalize")}>{i.priority}</span> : undefined,
        },
        { label: "Assignee", value: i.assignee?.name ?? <span className="font-normal text-muted-foreground">Unassigned</span> },
      ]}
    />
  )
}

function EventSections({ detail }: { detail: SentryIssueDetail }) {
  const ev = detail.event
  if (!ev) return <p className="text-sm text-muted-foreground">Sentry has no stored event for this issue.</p>
  return (
    <>
      <DetailSection
        title="Stack trace"
        icon={ListTreeIcon}
        hint={ev.dateCreated ? `latest event · ${timeAgo(Date.parse(ev.dateCreated))}` : "latest event"}
      >
        {ev.exceptions.length ? (
          <StackTrace exceptions={ev.exceptions} />
        ) : (
          <p className="rounded-xl border p-3 font-mono text-sm break-words">{ev.message || "No exception in this event."}</p>
        )}
      </DetailSection>

      {(ev.request?.url || ev.contexts.length > 0 || ev.user) && (
        <DetailSection title="Where it happened" icon={GlobeIcon}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border p-4 text-sm">
            {ev.request?.url && (
              <>
                <dt className="text-muted-foreground">Request</dt>
                <dd className="min-w-0 font-mono text-[13px] break-all">
                  {ev.request.method && <span className="mr-1.5 font-semibold">{ev.request.method}</span>}
                  {ev.request.url}
                </dd>
              </>
            )}
            {ev.contexts.map((c) => (
              <ContextRow key={c.name} name={c.name} value={c.value} />
            ))}
            {ev.user && (ev.user.id || ev.user.email || ev.user.username || ev.user.ip) && (
              <ContextRow name="User" value={[ev.user.username, ev.user.email, ev.user.id && `id ${ev.user.id}`, ev.user.ip].filter(Boolean).join(" · ")} />
            )}
          </dl>
        </DetailSection>
      )}

      {ev.breadcrumbs.length > 0 && <Breadcrumbs crumbs={ev.breadcrumbs} />}

      {detail.tags.length > 0 && (
        <DetailSection title="Tags" icon={TagIcon} count={detail.tags.length}>
          <div className="space-y-3">
            {detail.tags.map((t) => (
              <div key={t.key} className="text-sm">
                <p className="mb-1.5 text-xs text-muted-foreground">
                  {t.name || t.key} <span className="opacity-70">· {compact(t.total)}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {t.top.slice(0, 6).map((v) => (
                    <span key={v.value} className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border bg-surface px-2.5 text-xs">
                      <span className="max-w-72 truncate font-mono" title={v.value}>
                        {v.value}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{t.total ? `${Math.round((v.count / t.total) * 100)}%` : v.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DetailSection>
      )}
    </>
  )
}

function ContextRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground capitalize">{name}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  )
}

const CRUMB_TONE: Record<string, Tone> = {
  error: "danger",
  fatal: "danger",
  warning: "warning",
  info: "info",
  debug: "neutral",
}

function Breadcrumbs({ crumbs }: { crumbs: SentryBreadcrumb[] }) {
  const [open, setOpen] = useState(false)
  const recent = crumbs.slice(-BREADCRUMBS_SHOWN).reverse()
  return (
    <section className="space-y-2.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <ChevronRightIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        Breadcrumbs
        <span className="text-xs font-normal text-muted-foreground">
          {crumbs.length > BREADCRUMBS_SHOWN ? `last ${BREADCRUMBS_SHOWN} of ${crumbs.length}` : crumbs.length} · newest first
        </span>
      </button>
      {open && (
        <ol className="divide-y overflow-hidden rounded-xl border text-xs">
          {recent.map((c, i) => (
            <li key={i} className="flex items-start gap-2.5 px-3 py-2">
              <ToneDot tone={CRUMB_TONE[c.level ?? "info"] ?? "info"} className="mt-1" />
              <span className="w-16 shrink-0 font-mono text-muted-foreground tabular-nums">
                {c.timestamp ? new Date(c.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
              </span>
              {c.category && <span className="w-24 shrink-0 truncate font-mono text-muted-foreground">{c.category}</span>}
              <span className="min-w-0 flex-1 font-mono break-words">{c.message || c.type || ""}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
