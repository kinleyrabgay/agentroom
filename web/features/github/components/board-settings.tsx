"use client"

import { useState } from "react"
import { RefreshCwIcon, Settings2Icon, UnplugIcon } from "lucide-react"
import { toast } from "sonner"
import type { GithubProjectConfig } from "@shared"
import { githubApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { OPTION_COLORS } from "../constants"
import { setGithub, useGithubStore } from "../lib/github-store"
import { disconnectBoard, syncColumns } from "../lib/actions"

/** Gear menu: which columns show, hide empty ones, re-sync columns from GitHub, disconnect. */
export function BoardSettings({ project }: { project: GithubProjectConfig }) {
  const hideEmpty = useGithubStore((s) => s.hideEmpty)
  const [syncing, setSyncing] = useState(false)

  const toggleColumn = async (id: string, show: boolean) => {
    const hidden = show ? project.hiddenColumns.filter((c) => c !== id) : [...project.hiddenColumns, id]
    setGithub({ project: { ...project, hiddenColumns: hidden } })
    try {
      setGithub({ project: await githubApi.setHiddenColumns(hidden) })
    } catch (e) {
      setGithub({ project })
      toast.error((e as Error).message)
    }
  }

  const sync = async () => {
    setSyncing(true)
    await syncColumns()
    setSyncing(false)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Board settings">
          <Settings2Icon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="px-3 pt-3 pb-2 text-xs font-medium text-muted-foreground">Columns</div>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto px-2">
          {project.columns.map((c) => {
            const shown = !project.hiddenColumns.includes(c.id)
            return (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={shown} onCheckedChange={(v) => toggleColumn(c.id, v === true)} />
                  <span className="size-2 rounded-full" style={{ background: OPTION_COLORS[c.color ?? "GRAY"] ?? OPTION_COLORS.GRAY }} />
                  <span className="truncate">{c.name}</span>
                </label>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center justify-between px-3 py-2.5">
          <Label htmlFor="gh-hide-empty" className="text-xs">Collapse empty columns</Label>
          <Switch id="gh-hide-empty" checked={hideEmpty} onCheckedChange={(v) => setGithub({ hideEmpty: v })} />
        </div>
        <Separator />
        <div className="flex items-center gap-2 p-2">
          <Button size="xs" variant="ghost" onClick={sync} disabled={syncing}>
            <RefreshCwIcon data-icon="inline-start" className={syncing ? "animate-spin" : undefined} /> Sync columns
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
        <p className="flex items-center gap-1.5 border-t px-3 py-2 text-[10px] text-muted-foreground">
          <UnplugIcon className="size-3" /> Columns synced {new Date(project.columnsSyncedAt).toLocaleString()}
        </p>
      </PopoverContent>
    </Popover>
  )
}
