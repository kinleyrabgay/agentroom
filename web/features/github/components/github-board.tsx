"use client"

import { useCallback, useMemo } from "react"
import { Loader2Icon } from "lucide-react"
import type { Goal } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { isFinished } from "@/features/tasks/lib/goal-phase"
import { Skeleton } from "@/components/ui/skeleton"
import { useGithubBoard } from "../hooks/use-github-board"
import { groupByColumn, matches } from "../lib/board-view"
import { setAssignee, setGithub, SetupState, toggleSelect, useGithubStore } from "../lib/github-store"
import { AssigneeFilter } from "../constants"
import { Button } from "@/components/ui/button"
import { UserRoundXIcon } from "lucide-react"
import { BoardHeader } from "./board-header"
import { GhError } from "./gh-error"
import { GithubColumn } from "./github-column"
import { HandoffDialog } from "./handoff-dialog"
import { ItemSheet } from "./item-sheet"
import { SelectionBar } from "./selection-bar"
import { SetupCard } from "./setup-card"

/** Workspace → Board: the team's GitHub project, mirrored. */
export function GithubBoard() {
  useGithubBoard()
  const setup = useGithubStore((s) => s.setup)
  const setupError = useGithubStore((s) => s.setupError)

  if (setup === SetupState.Loading) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    )
  }
  if (setup === SetupState.Error) {
    return (
      <div className="grid h-full place-items-center p-6">
        <GhError message={setupError ?? "Unknown error"} className="max-w-lg" />
      </div>
    )
  }
  if (setup === SetupState.None) return <SetupCard />
  return <ConnectedBoard />
}

function ConnectedBoard() {
  const project = useGithubStore((s) => s.project)
  const board = useGithubStore((s) => s.board)
  const error = useGithubStore((s) => s.error)
  const search = useGithubStore((s) => s.search)
  const assignee = useGithubStore((s) => s.assignee)
  const label = useGithubStore((s) => s.label)
  const sprint = useGithubStore((s) => s.sprint)
  const hideEmpty = useGithubStore((s) => s.hideEmpty)
  const selectedIds = useGithubStore((s) => s.selected)
  const goals = useAppStore((s) => s.goals)

  const items = useMemo(() => board?.items ?? [], [board])
  const visible = useMemo(
    () => items.filter((i) => matches(i, { search, assignee, label, sprint }, board?.viewer ?? null)),
    [items, search, assignee, label, sprint, board?.viewer]
  )
  const columns = useMemo(() => (project ? groupByColumn(project.columns, project.hiddenColumns, visible) : []), [project, visible])
  const order = useMemo(() => columns.flatMap((c) => c.items.map((i) => i.id)), [columns])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  // Active goals by the GitHub card they came from.
  const goalByItem = useMemo(() => {
    const map = new Map<string, Goal>()
    for (const g of goals) {
      if (isFinished(g.status)) continue
      for (const s of g.sources ?? []) map.set(s.itemId, g)
    }
    return map
  }, [goals])
  const goalFor = useCallback((id: string) => goalByItem.get(id), [goalByItem])
  const onToggle = useCallback((id: string, range: boolean) => toggleSelect(id, range, order), [order])
  const onOpen = useCallback((id: string) => setGithub({ openItemId: id }), [])

  if (!project) return null

  return (
    <div className="absolute inset-0 flex flex-col">
      <BoardHeader project={project} items={items} />
      {board && assignee === AssigneeFilter.Mine && visible.length === 0 && items.length > 0 && !search && !label && !sprint && (
        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm">
          <UserRoundXIcon className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">Nothing is assigned to you on this board.</span>
          <Button size="xs" variant="outline" onClick={() => setAssignee(AssigneeFilter.Anyone)}>
            Show all {items.length} cards
          </Button>
        </div>
      )}
      {!board ? (
        error ? (
          <div className="p-6"><GhError message={error} className="max-w-xl" /></div>
        ) : (
          <div className="flex gap-3 p-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 w-72 rounded-2xl" />)}
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="flex h-full gap-3 p-4">
            {columns.map((view) => (
              <GithubColumn
                key={view.column.id}
                view={view}
                collapsed={hideEmpty && view.items.length === 0}
                selected={selected}
                goalFor={goalFor}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))}
            {visible.length === 0 && items.length > 0 && !(assignee === AssigneeFilter.Mine && !search && !label && !sprint) && (
              <p className="self-center px-6 text-sm text-muted-foreground">No cards match these filters.</p>
            )}
          </div>
        </div>
      )}
      <SelectionBar />
      <ItemSheet goalFor={goalFor} />
      <HandoffDialog />
    </div>
  )
}
