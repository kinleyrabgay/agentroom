"use client"

import { memo } from "react"
import { CalendarRangeIcon, FlagIcon, GitPullRequestIcon } from "lucide-react"
import type { Goal, GithubItem } from "@shared"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { itemRef } from "../lib/board-view"
import { Avatars } from "./avatars"
import { GoalBadge } from "./goal-badge"
import { ItemTypeIcon } from "./item-type-icon"
import { LabelPill } from "./label-pill"

const MAX_LABELS = 3

interface Props {
  item: GithubItem
  selected: boolean
  /** Anything is selected: checkboxes stay visible. */
  selecting: boolean
  open: boolean
  goal?: Goal
  onToggle: (id: string, range: boolean) => void
  onOpen: (id: string) => void
}

/**
 * A GitHub card: ref, title, labels, priority/sprint, PRs, assignees. Enter opens it, Space selects it;
 * the checkbox shows on hover/focus and stays while anything is selected.
 */
export const GithubCard = memo(function GithubCard({ item, selected, selecting, open, goal, onToggle, onOpen }: Props) {
  const showCheck = selected || selecting
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${itemRef(item)} ${item.title}`}
      onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? onToggle(item.id, e.shiftKey) : onOpen(item.id))}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(item.id)
        if (e.key === " ") {
          e.preventDefault()
          onToggle(item.id, e.shiftKey)
        }
      }}
      className={cn(
        "group relative cursor-pointer rounded-xl border bg-card p-3 text-sm transition-[border-color,box-shadow] outline-none hover:border-foreground/20 hover:shadow-xs focus-visible:ring-2 focus-visible:ring-ring/60",
        selected && "border-brand/60 ring-2 ring-brand/15",
        open && !selected && "border-foreground/25 shadow-xs"
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className={cn(
            "-ml-0.5 transition-[opacity,width] duration-150",
            showCheck ? "w-5 opacity-100" : "w-0 opacity-0 group-hover:w-5 group-hover:opacity-100 group-focus-within:w-5 group-focus-within:opacity-100"
          )}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(item.id, e.shiftKey)
          }}
        >
          <Checkbox checked={selected} tabIndex={-1} aria-label={`Select ${itemRef(item)}`} className="bg-surface" />
        </span>
        <ItemTypeIcon item={item} />
        <span className="truncate font-mono">{itemRef(item)}</span>
        {goal && <GoalBadge goal={goal} className="ml-auto" />}
      </div>

      <p className="mt-1.5 line-clamp-2 leading-snug font-medium text-foreground/90">{item.title}</p>

      {item.labels.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {item.labels.slice(0, MAX_LABELS).map((l) => (
            <LabelPill key={l.name} label={l} />
          ))}
          {item.labels.length > MAX_LABELS && <span className="self-center text-xs text-muted-foreground">+{item.labels.length - MAX_LABELS}</span>}
        </div>
      )}

      {(item.priority || item.iteration || item.linkedPrs.length > 0 || item.assignees.length > 0) && (
        <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground">
          {item.priority && (
            <span className="flex max-w-28 items-center gap-1 truncate" title="Priority">
              <FlagIcon className="size-3.5 shrink-0" /> {item.priority}
            </span>
          )}
          {item.iteration && (
            <span className="flex max-w-28 items-center gap-1 truncate" title="Sprint">
              <CalendarRangeIcon className="size-3.5 shrink-0" /> {item.iteration}
            </span>
          )}
          {item.linkedPrs.length > 0 && (
            <span className="flex items-center gap-1 tabular-nums" title={`${item.linkedPrs.length} linked pull request(s)`}>
              <GitPullRequestIcon className="size-3.5" /> {item.linkedPrs.length}
            </span>
          )}
          <Avatars users={item.assignees} className="ml-auto" />
        </div>
      )}
    </div>
  )
})
