"use client"

import { ExternalLinkIcon, RefreshCwIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import type { GithubItem, GithubProjectConfig } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { useNow } from "@/hooks/use-now"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dropdown } from "@/components/kit/dropdown"
import { Segmented } from "@/components/kit/segmented"
import { PageActions } from "@/components/layout/page-actions"
import { AssigneeFilter } from "../constants"
import { loadBoard } from "../lib/actions"
import { facets, isAuthError } from "../lib/board-view"
import { setAssignee, setGithub, useGithubStore } from "../lib/github-store"
import { BoardSettings } from "./board-settings"

const ALL = "__all__"

/** Top-bar actions: the project link, freshness, Refresh and board settings. */
export function BoardActions({ project }: { project: GithubProjectConfig }) {
  const fetchedAt = useGithubStore((s) => s.board?.fetchedAt)
  const refreshing = useGithubStore((s) => s.refreshing)
  const error = useGithubStore((s) => s.error)
  const now = useNow()

  return (
    <PageActions>
      {error ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="tone-warning tone-text hidden items-center gap-1 text-xs sm:flex" tabIndex={0}>
              <TriangleAlertIcon className="size-3.5" />
              Couldn&apos;t refresh{isAuthError(error) ? " (gh auth)" : ""}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-80">{error}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="hidden text-xs text-muted-foreground tabular-nums lg:inline">{fetchedAt ? `Updated ${timeAgo(fetchedAt, now)}` : "Loading…"}</span>
      )}
      <Button asChild size="sm" variant="ghost" className="hidden text-muted-foreground md:inline-flex">
        <a href={project.url} target="_blank" rel="noreferrer noopener">
          <span className="max-w-48 truncate">{project.title}</span>
          <ExternalLinkIcon data-icon="inline-end" />
        </a>
      </Button>
      <Button size="icon-sm" variant="outline" onClick={() => loadBoard(true)} disabled={refreshing} aria-label="Refresh board">
        <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
      </Button>
      <BoardSettings project={project} />
    </PageActions>
  )
}

/** Search and filters, in one row above the columns. */
export function BoardToolbar({ items }: { items: GithubItem[] }) {
  const search = useGithubStore((s) => s.search)
  const assignee = useGithubStore((s) => s.assignee)
  const label = useGithubStore((s) => s.label)
  const sprint = useGithubStore((s) => s.sprint)
  const { labels, sprints } = facets(items)
  const filtered = !!search || !!label || !!sprint

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-4 pb-3">
      <div className="relative w-full max-w-72 min-w-48 flex-1 sm:flex-none">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setGithub({ search: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && setGithub({ search: "" })}
          placeholder="Search cards"
          aria-label="Search cards"
          className="h-8 rounded-full pl-9 text-[13px]"
        />
      </div>
      <Segmented<AssigneeFilter>
        aria-label="Assignee"
        value={assignee}
        onChange={setAssignee}
        options={[
          { value: AssigneeFilter.Mine, label: "Mine" },
          { value: AssigneeFilter.Unassigned, label: "Unassigned" },
          { value: AssigneeFilter.Anyone, label: "Anyone" },
        ]}
      />
      {labels.length > 0 && (
        <Dropdown<string>
          variant="pill"
          label="Label"
          active={!!label}
          datas={[{ value: ALL, label: "Any" }, ...labels.map((l) => ({ value: l.name, label: l.name }))]}
          selectedValue={label ?? ALL}
          hint="Find a label"
          onSelect={(v) => setGithub({ label: v === ALL ? null : (v as string) })}
        />
      )}
      {sprints.length > 0 && (
        <Dropdown<string>
          variant="pill"
          label="Sprint"
          active={!!sprint}
          datas={[{ value: ALL, label: "Any" }, ...sprints.map((s) => ({ value: s, label: s }))]}
          selectedValue={sprint ?? ALL}
          hint="Find a sprint"
          onSelect={(v) => setGithub({ sprint: v === ALL ? null : (v as string) })}
        />
      )}
      {filtered && (
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setGithub({ search: "", label: null, sprint: null })}>
          <XIcon data-icon="inline-start" /> Reset
        </Button>
      )}
    </div>
  )
}
