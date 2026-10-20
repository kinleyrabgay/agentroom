"use client"

import { useEffect } from "react"
import { ArrowRightIcon, KeyRoundIcon } from "lucide-react"
import type { TrackerId } from "@shared"
import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { ToneBadge } from "@/components/kit/badge"
import { PropertyGrid } from "@/components/kit/property-grid"
import { TRACKER_META } from "../lib/meta"
import { loadTrackerStatus, setTracker, useTrackerStore } from "../lib/tracker-store"

const VIEW_OF: Record<TrackerId, View> = { linear: View.Linear, jira: View.Jira }

/** Linear or Jira in Settings → Integrations: what's connected; setup happens on the tracker's page. */
export function TrackerConnectionSettings({ tracker }: { tracker: TrackerId }) {
  const status = useTrackerStore((s) => s[tracker].status)
  const meta = TRACKER_META[tracker]
  const Icon = meta.icon
  const config = status?.config
  const sync = config?.sync
  const syncText = sync ? [sync.onStart && `start → ${sync.onStart}`, sync.onPr && `PR → ${sync.onPr}`, sync.commentPr && "PR link comment"].filter(Boolean).join(" · ") : ""

  useEffect(() => {
    void loadTrackerStatus(tracker)
  }, [tracker])

  const open = (editing: boolean) => {
    setTracker(tracker, { editing })
    useAppStore.getState().setView(VIEW_OF[tracker])
  }
  const state = !status ? null : status.hasToken && config ? { tone: "success" as const, label: "Connected" } : config ? { tone: "warning" as const, label: "Needs your credentials" } : null

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-surface text-brand">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {meta.label} issues
            {state && (
              <ToneBadge size="sm" tone={state.tone} dot>
                {state.label}
              </ToneBadge>
            )}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Your {meta.scope} choice is shared through <code className="font-mono">{meta.file}</code>. Credentials stay on this machine.
          </p>
        </div>
      </div>
      {config ? (
        <>
          <PropertyGrid
            className="rounded-lg bg-sunken/60 p-3 sm:grid-cols-2"
            items={[
              { label: meta.scope === "team" ? "Team" : "Project", value: `${config.scopeName} (${config.scopeKey})` },
              { label: "Credentials", value: status?.hasToken ? <ToneBadge size="sm" tone="success" icon={KeyRoundIcon}>Set</ToneBadge> : "Not on this machine" },
              { label: "Status sync", value: syncText || "Off (read-only)", wide: true },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => open(!!status?.hasToken)}>
              {status?.hasToken ? `Change ${meta.scope} or sync` : "Add your credentials"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => open(false)}>
              Open issues <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" onClick={() => open(false)}>
          Connect {meta.label} <ArrowRightIcon data-icon="inline-end" />
        </Button>
      )}
    </div>
  )
}
