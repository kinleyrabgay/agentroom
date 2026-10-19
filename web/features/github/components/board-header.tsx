"use client"

import { ExternalLinkIcon, RefreshCwIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"
import type { GithubItem, GithubProjectConfig } from "@shared"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AssigneeFilter } from "../constants"
import { loadBoard } from "../lib/actions"
import { facets, isAuthError } from "../lib/board-view"
import { setAssignee, setGithub, useGithubStore } from "../lib/github-store"
import { useNow } from "@/hooks/use-now"
import { BoardSettings } from "./board-settings"
import { LabelPill } from "./label-pill"

const ALL = "__all__"

/** Title, freshness, refresh, filters and settings. */
export function BoardHeader({ project, items }: { project: GithubProjectConfig; items: GithubItem[] }) {
  const fetchedAt = useGithubStore((s) => s.board?.fetchedAt)
  const refreshing = useGithubStore((s) => s.refreshing)
  const error = useGithubStore((s) => s.error)
  const search = useGithubStore((s) => s.search)
  const assignee = useGithubStore((s) => s.assignee)
  const label = useGithubStore((s) => s.label)
  const sprint = useGithubStore((s) => s.sprint)
  const now = useNow()
  const { labels, sprints } = facets(items)

  return (
    <div className="space-y-3 border-b px-4 pt-3 pb-3">
      <div className="flex items-center gap-2">
        <a href={project.url} target="_blank" rel="noreferrer noopener" className="group flex min-w-0 items-center gap-1.5 font-medium hover:underline">
          <span className="truncate">{project.title}</span>
          <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </a>
        <span className="truncate text-xs text-muted-foreground">
          {fetchedAt ? `Updated ${timeAgo(fetchedAt, now)}` : "Loading…"}
        </span>
        {error && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <TriangleAlertIcon className="size-3.5 shrink-0" />
                <span className="truncate">couldn&apos;t refresh{isAuthError(error) ? " (gh auth)" : ""}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-80">{error}</TooltipContent>
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => loadBoard(true)} disabled={refreshing}>
            <RefreshCwIcon data-icon="inline-start" className={refreshing ? "animate-spin" : undefined} /> Refresh
          </Button>
          <BoardSettings project={project} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setGithub({ search: e.target.value })} placeholder="Search cards" className="h-8 pl-8 text-sm" />
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={assignee}
          onValueChange={(v) => v && setAssignee(v as AssigneeFilter)}
          aria-label="Assignee"
        >
          <ToggleGroupItem value={AssigneeFilter.Mine} className="px-3 text-xs">Mine</ToggleGroupItem>
          <ToggleGroupItem value={AssigneeFilter.Unassigned} className="px-3 text-xs">Unassigned</ToggleGroupItem>
          <ToggleGroupItem value={AssigneeFilter.Anyone} className="px-3 text-xs">Anyone</ToggleGroupItem>
        </ToggleGroup>
        {labels.length > 0 && (
          <Select value={label ?? ALL} onValueChange={(v) => setGithub({ label: v === ALL ? null : v })}>
            <SelectTrigger size="sm" className="h-8 w-40 text-xs"><SelectValue placeholder="Label" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All labels</SelectItem>
              {labels.map((l) => (
                <SelectItem key={l.name} value={l.name}><LabelPill label={l} /></SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {sprints.length > 0 && (
          <Select value={sprint ?? ALL} onValueChange={(v) => setGithub({ sprint: v === ALL ? null : v })}>
            <SelectTrigger size="sm" className="h-8 w-40 text-xs"><SelectValue placeholder="Sprint" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sprints</SelectItem>
              {sprints.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}
