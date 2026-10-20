"use client"

import { useEffect, useState } from "react"
import { ExternalLinkIcon, FileTextIcon, MessageSquareIcon } from "lucide-react"
import { toast } from "sonner"
import type { TrackerId } from "@shared"
import { trackerApi } from "@/lib/api/intake-endpoints"
import { timeAgo } from "@/lib/time"
import { DetailSection, HandoffSection, InspectorPanel, JumpToHandoff } from "@/components/shared/inspector-panel"
import { Markdown } from "@/components/shared/markdown"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { Dropdown } from "@/components/kit/dropdown"
import { PropertyGrid } from "@/components/kit/property-grid"
import { GoalBadge } from "@/features/github/components/goal-badge"
import { useGoalsBySource } from "@/features/github/lib/source-goal"
import { CATEGORY_TONE, ISSUE_FIXER, TRACKER_META } from "../lib/meta"
import { loadTrackerDetail, loadTrackerIssues, setTracker, useTrackerStore } from "../lib/tracker-store"

const HANDOFF_ID = "tracker-handoff"
const COMMENTS_SHOWN = 15

/** Issue details in the Inspector: state (movable on click), description, comments; hand-off at the bottom. */
export function TrackerIssueInspector({ tracker, id }: { tracker: TrackerId; id: string }) {
  const issue = useTrackerStore((s) => s[tracker].issues.find((i) => i.id === id) ?? s[tracker].details[id]?.issue)
  const detail = useTrackerStore((s) => s[tracker].details[id])
  const detailError = useTrackerStore((s) => s[tracker].detailErrors[id])
  const states = useTrackerStore((s) => s[tracker].states)
  const goal = useGoalsBySource(tracker).get(id)
  const meta = TRACKER_META[tracker]
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    void loadTrackerDetail(tracker, id)
  }, [tracker, id])

  const close = () => setTracker(tracker, { openIssueId: null })

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

  // A click is an explicit write to the tracker; it's audited on the server.
  const move = async (state: string) => {
    if (state === issue.state.name) return
    setMoving(true)
    try {
      await trackerApi.move(tracker, issue.id, state)
      toast.success(`${issue.key} moved to ${state}`)
      await Promise.all([loadTrackerIssues(tracker, { refresh: true }), loadTrackerDetail(tracker, id, true)])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setMoving(false)
    }
  }

  return (
    <InspectorPanel
      label={`${meta.label} issue ${issue.key}`}
      onClose={close}
      refLine={
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border bg-sunken px-1.5 py-px font-mono text-xs font-semibold">{issue.key}</span>
          <ToneBadge size="sm" tone={CATEGORY_TONE[issue.state.category]} dot>
            {issue.state.name}
          </ToneBadge>
          {goal && <GoalBadge goal={goal} />}
        </div>
      }
      title={issue.title}
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <a href={issue.url} target="_blank" rel="noreferrer noopener">
              <ExternalLinkIcon data-icon="inline-start" /> Open in {meta.label}
            </a>
          </Button>
          {states.length > 0 && (
            <Dropdown<string>
              variant="pill"
              label="Move to"
              disabled={moving}
              showSearch={states.length > 8}
              datas={states.map((s) => ({ value: s.name, label: s.name }))}
              selectedValue={issue.state.name}
              onSelect={(v) => void move(v as string)}
            />
          )}
          <JumpToHandoff targetId={HANDOFF_ID} />
        </>
      }
    >
      <div className="space-y-6 p-5">
        <PropertyGrid
          className="rounded-xl bg-sunken/60 p-3 sm:grid-cols-3"
          items={[
            { label: "Priority", value: issue.priority?.label ?? "None" },
            { label: "Assignee", value: issue.assignee?.name ?? "Unassigned" },
            { label: "Updated", value: timeAgo(Date.parse(issue.updatedAt)) },
            ...(issue.type ? [{ label: "Type", value: issue.type }] : []),
            ...(issue.labels.length ? [{ label: "Labels", value: issue.labels.join(", "), wide: true }] : []),
          ]}
        />

        {!detail ? (
          detailError ? (
            <Callout tone="danger" title="Couldn't load the description">{detailError}</Callout>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          )
        ) : (
          <>
            <DetailSection title="Description" icon={FileTextIcon}>
              {detail.description.trim() ? (
                <div className="rounded-xl border bg-surface p-3 text-sm">
                  <Markdown text={detail.description} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
            </DetailSection>
            <DetailSection title="Comments" icon={MessageSquareIcon} count={detail.comments.length}>
              {detail.comments.length ? (
                <ol className="space-y-2">
                  {detail.comments.slice(-COMMENTS_SHOWN).map((c, i) => (
                    <li key={i} className="rounded-xl border bg-surface px-3 py-2">
                      <p className="mb-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.author}</span> · {timeAgo(Date.parse(c.createdAt))}
                      </p>
                      <div className="text-sm">
                        <Markdown text={c.body} />
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No comments.</p>
              )}
            </DetailSection>
          </>
        )}

        <HandoffSection
          id={HANDOFF_ID}
          description="The description and recent comments go along, marked as untrusted data. Add what only you know."
          form={{
            count: 1,
            directContent: `the ${meta.label} issue`,
            newBot: ISSUE_FIXER,
            send: (input) => trackerApi.handoff(tracker, { issueIds: [issue.id], ...input }),
            later: { source: tracker, ids: [issue.id], label: issue.key },
            onDone: close,
          }}
        />
      </div>
    </InspectorPanel>
  )
}
