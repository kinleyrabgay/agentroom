"use client"

import { useEffect } from "react"
import { ArrowRightIcon, BugIcon, KeyRoundIcon } from "lucide-react"
import { toast } from "sonner"
import { View } from "@/lib/constants"
import { sentryApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { ToneBadge } from "@/components/kit/badge"
import { PropertyGrid } from "@/components/kit/property-grid"
import { loadStatus } from "../lib/actions"
import { SentrySetup, setSentry, useSentryStore } from "../lib/sentry-store"

/** Open the Sentry page's setup flow (token or org/projects). */
function openSetup() {
  setSentry({ editing: true })
  useAppStore.getState().setView(View.Sentry)
}

/**
 * Sentry in Settings → Integrations: which org and projects the Sentry page shows, whether the token
 * is set, with Change and Disconnect. The setup itself happens on the Sentry page. Props-free.
 */
export function SentryConnectionSettings() {
  const setup = useSentryStore((s) => s.setup)
  const status = useSentryStore((s) => s.status)
  const config = status?.config

  useEffect(() => {
    void loadStatus()
  }, [])

  const disconnect = async () => {
    try {
      await sentryApi.disconnect()
      setSentry({ issues: [], nextCursor: null, selected: [], details: {}, editing: false, openIssueId: null })
      await loadStatus()
      toast.success("Sentry disconnected", { description: "Your token stays in local secrets." })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const state =
    setup === SentrySetup.Connected
      ? { tone: "success" as const, label: "Connected" }
      : setup === SentrySetup.NeedsToken
        ? { tone: "warning" as const, label: "Needs a token" }
        : setup === SentrySetup.NeedsConfig
          ? { tone: "warning" as const, label: "Pick an organization" }
          : setup === SentrySetup.Error
            ? { tone: "danger" as const, label: "Unavailable" }
            : null
  const selfHosted = !!config?.host && !/sentry\.io/.test(config.host)

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-surface text-brand">
          <BugIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            Sentry issues
            {state && (
              <ToneBadge size="sm" tone={state.tone} dot>
                {state.label}
              </ToneBadge>
            )}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Org and projects are saved for the team in <code className="font-mono">.agentroom/sentry.json</code>. The token stays on this machine.
          </p>
        </div>
      </div>

      {setup === SentrySetup.Connected && config ? (
        <>
          <PropertyGrid
            className="rounded-lg bg-sunken/60 p-3 sm:grid-cols-4"
            items={[
              { label: "Organization", value: config.orgName ?? config.org },
              { label: "Projects", value: config.projects.length ? config.projects.join(", ") : "All projects" },
              { label: "Environment", value: config.environment ?? "All" },
              { label: "Token", value: status?.hasToken ? <ToneBadge size="sm" tone="success" icon={KeyRoundIcon}>Set</ToneBadge> : undefined },
              ...(selfHosted ? [{ label: "Server", value: <span className="font-mono text-[13px]">{config.host}</span>, wide: true }] : []),
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={openSetup}>
              Change org or projects
            </Button>
            <Button size="sm" variant="ghost" onClick={() => useAppStore.getState().setView(View.Sentry)}>
              Open issues <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <div className="ml-auto">
              <ConfirmDelete
                title="Disconnect Sentry?"
                description="Removes .agentroom/sentry.json for everyone on the team once committed. Your token stays in local secrets; nothing changes in Sentry."
                label="Disconnect"
                onConfirm={disconnect}
              />
            </div>
          </div>
        </>
      ) : setup === SentrySetup.Loading ? null : (
        <Button size="sm" onClick={openSetup}>
          Connect Sentry <ArrowRightIcon data-icon="inline-end" />
        </Button>
      )}
    </div>
  )
}
