"use client"

import { useEffect, useState } from "react"
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { ToneBadge } from "@/components/kit/badge"
import { GithubMark } from "@/components/kit/brand-icons"
import { disconnectBoard, loadProject, syncColumns } from "../lib/actions"
import { SetupState, useGithubStore } from "../lib/github-store"
import { ColumnPills } from "./column-pills"
import { ConnectForm } from "./connect-form"
import { GhError } from "./gh-error"

/**
 * GitHub in Settings → Integrations: which project board is connected, with Change, Sync columns
 * and Disconnect; or the connect form when there is none. Props-free.
 */
export function GithubConnectionSettings() {
  const setup = useGithubStore((s) => s.setup)
  const setupError = useGithubStore((s) => s.setupError)
  const project = useGithubStore((s) => s.project)
  const [changing, setChanging] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (useGithubStore.getState().setup === SetupState.Loading) void loadProject()
  }, [])

  const connected = setup === SetupState.Connected && !!project

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-surface">
          <GithubMark className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            GitHub project board
            {setup !== SetupState.Loading && (
              <ToneBadge size="sm" tone={connected ? "success" : "neutral"} dot>
                {connected ? "Connected" : "Not connected"}
              </ToneBadge>
            )}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Uses your <code className="font-mono">gh</code> login. Saved for the team in <code className="font-mono">.agentroom/github/project.json</code>.
          </p>
        </div>
      </div>

      {setup === SetupState.Error && setupError && <GhError message={setupError} />}

      {connected && !changing ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-sunken/60 px-3 py-2.5 text-sm">
            <a
              href={project.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-w-0 items-center gap-1 font-medium outline-none hover:underline focus-visible:underline"
            >
              <span className="truncate">{project.title}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
            <span className="font-mono text-xs text-muted-foreground">
              {project.owner}/{project.number}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">Columns synced {new Date(project.columnsSyncedAt).toLocaleDateString()}</span>
          </div>
          <ColumnPills columns={project.columns} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
              Change board
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true)
                await syncColumns()
                setSyncing(false)
              }}
            >
              <RefreshCwIcon data-icon="inline-start" className={cn(syncing && "animate-spin")} /> Sync columns
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
        </div>
      ) : setup !== SetupState.Loading ? (
        <div className="space-y-2">
          <ConnectForm confirmLabel="Done" onDone={() => setChanging(false)} />
          {changing && (
            <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>
              Cancel
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
