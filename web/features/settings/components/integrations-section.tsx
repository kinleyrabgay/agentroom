"use client"

import { useEffect, useState } from "react"
import { ExternalLinkIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { ColumnPills } from "@/features/github/components/column-pills"
import { ConnectForm } from "@/features/github/components/connect-form"
import { GhError } from "@/features/github/components/gh-error"
import { GithubMark } from "@/features/github/components/github-mark"
import { disconnectBoard, loadProject, syncColumns } from "@/features/github/lib/actions"
import { SetupState, useGithubStore } from "@/features/github/lib/github-store"
import { SettingsSection } from "../lib/constants"
import { SettingsCard } from "./settings-card"

/** Connected services. Today: the GitHub project board. */
export function IntegrationsSection() {
  const setup = useGithubStore((s) => s.setup)
  const setupError = useGithubStore((s) => s.setupError)
  const project = useGithubStore((s) => s.project)
  const [syncing, setSyncing] = useState(false)

  // The Board view loads this too; load it here if the user came straight to Settings.
  useEffect(() => {
    if (setup === SetupState.Loading) void loadProject()
  }, [setup])

  const sync = async () => {
    setSyncing(true)
    await syncColumns()
    setSyncing(false)
  }

  return (
    <SettingsCard id={SettingsSection.Integrations}>
      <div className="rounded-xl border">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <span className="grid size-8 place-items-center rounded-lg bg-muted">
            <GithubMark className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">GitHub project board</div>
            <div className="text-xs text-muted-foreground">
              Mirrors your project on the Board view. Uses your <code className="font-mono">gh</code> login; writes only when you assign or
              unassign yourself.
            </div>
          </div>
        </div>
        <div className="space-y-3 px-4 py-4">
          {setup === SetupState.Loading ? (
            <Skeleton className="h-10 w-full" />
          ) : project ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <a href={project.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 font-medium hover:underline">
                  {project.title} <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                </a>
                <span className="font-mono text-xs text-muted-foreground">
                  {project.owner}/{project.number}
                </span>
                <span className="text-xs text-muted-foreground">
                  · {project.columns.length} columns · synced {timeAgo(Date.parse(project.columnsSyncedAt))}
                </span>
              </div>
              <ColumnPills columns={project.columns} />
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
                  {syncing ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                  Sync columns
                </Button>
                <div className="ml-auto">
                  <ConfirmDelete
                    title="Disconnect this board?"
                    description="Removes .agentroom/github/project.json for everyone on the team once committed. Nothing changes on GitHub."
                    label="Disconnect"
                    onConfirm={disconnectBoard}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <ConnectForm confirmLabel="Done" />
              {setup === SetupState.Error && setupError && <GhError message={setupError} />}
              <p className="text-[11px] text-muted-foreground">
                Saved to <code className="font-mono">.agentroom/github/project.json</code> so your team shares it.
              </p>
            </>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
