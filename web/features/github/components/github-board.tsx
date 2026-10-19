"use client"

import { useCallback, useMemo } from "react"
import { UserRoundXIcon } from "lucide-react"
import type { GithubItem } from "@shared"
import { githubApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/kit/callout"
import { LoadingState } from "@/components/kit/state-view"
import { HandoffDialog } from "@/components/shared/handoff-dialog"
import { SelectionBar } from "@/components/shared/selection-bar"
import { AssigneeFilter } from "../constants"
import { useGithubBoard } from "../hooks/use-github-board"
import { groupByColumn, itemRef, matches } from "../lib/board-view"
import { clearSelection, setAssignee, setGithub, SetupState, toggleSelect, useGithubStore } from "../lib/github-store"
import { useGoalsBySource } from "../lib/source-goal"
import { BoardActions, BoardToolbar } from "./board-toolbar"
import { GhError } from "./gh-error"
import { GithubColumn } from "./github-column"
import { ItemTypeIcon } from "./item-type-icon"
import { SetupCard } from "./setup-card"

const NO_ITEMS: GithubItem[] = []

/** Workspace → GitHub: the team's GitHub project, mirrored. Card details open in the Inspector. */
export function GithubBoard() {
  useGithubBoard()
  const setup = useGithubStore((s) => s.setup)
  const setupError = useGithubStore((s) => s.setupError)

  if (setup === SetupState.Loading) return <LoadingState label="Loading the board…" className="h-full" />
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
  const openId = useGithubStore((s) => s.openItemId)
  const handoffOpen = useGithubStore((s) => s.handoffOpen)
  const goalByItem = useGoalsBySource("github")

  const items = board?.items ?? NO_ITEMS
  const viewer = board?.viewer ?? null
  const visible = useMemo(() => items.filter((i) => matches(i, { search, assignee, label, sprint }, viewer)), [items, search, assignee, label, sprint, viewer])
  const columns = useMemo(() => (project ? groupByColumn(project.columns, project.hiddenColumns, visible) : []), [project, visible])
  const order = useMemo(() => columns.flatMap((c) => c.items.map((i) => i.id)), [columns])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const picked = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected])

  const goalFor = useCallback((id: string) => goalByItem.get(id), [goalByItem])
  const onToggle = useCallback((id: string, range: boolean) => toggleSelect(id, range, order), [order])
  const onOpen = useCallback((id: string) => setGithub({ openItemId: id }), [])

  if (!project) return null
  const nothingMine = !!board && assignee === AssigneeFilter.Mine && visible.length === 0 && items.length > 0 && !search && !label && !sprint

  return (
    <div className="absolute inset-0 flex flex-col">
      <BoardActions project={project} />
      <BoardToolbar items={items} />
      {nothingMine && (
        <div className="px-6 pb-3">
          <Callout
            tone="info"
            icon={UserRoundXIcon}
            action={
              <Button size="sm" variant="outline" onClick={() => setAssignee(AssigneeFilter.Anyone)}>
                Show all {items.length} cards
              </Button>
            }
          >
            Nothing on this board is assigned to you.
          </Callout>
        </div>
      )}
      {!board ? (
        error ? (
          <div className="px-6">
            <GhError message={error} className="max-w-xl" />
          </div>
        ) : (
          <div className="flex gap-3 px-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-80 w-[19rem] rounded-2xl" />
            ))}
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="flex h-full gap-3 px-6 pb-6">
            {columns.map((view) => (
              <GithubColumn
                key={view.column.id}
                view={view}
                collapsed={hideEmpty && view.items.length === 0}
                selected={selected}
                openId={openId}
                goalFor={goalFor}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))}
            {visible.length === 0 && items.length > 0 && !nothingMine && (
              <p className="self-center px-6 text-sm text-muted-foreground">No cards match these filters.</p>
            )}
          </div>
        </div>
      )}
      <SelectionBar count={selectedIds.length} noun={["card", "cards"]} onClear={clearSelection} onHandoff={() => setGithub({ handoffOpen: true })} />
      <HandoffDialog
        open={handoffOpen}
        onOpenChange={(o) => setGithub({ handoffOpen: o })}
        title={picked.length === 1 ? "Hand off card" : `Hand off ${picked.length} cards`}
        description="Pick who takes them and add anything the team should know."
        items={picked.map((c) => ({ id: c.id, icon: <ItemTypeIcon item={c} />, ref: itemRef(c), title: c.title }))}
        onRemove={(id) => setGithub({ selected: selectedIds.filter((x) => x !== id) })}
        form={{
          directContent: "the card details",
          send: (input) => githubApi.handoff({ itemIds: picked.map((c) => c.id), ...input }),
          later: { source: "github", ids: picked.map((c) => c.id), label: picked.length === 1 ? (picked[0]!.title ?? "1 card") : `${picked.length} cards` },
          onDone: () => {
            clearSelection()
            setGithub({ handoffOpen: false })
          },
        }}
      />
    </div>
  )
}
