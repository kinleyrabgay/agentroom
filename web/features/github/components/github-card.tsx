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
  goal?: Goal
  onToggle: (id: string, range: boolean) => void
  onOpen: (id: string) => void
}

/** A GitHub card: ref, title, labels, priority/sprint, PRs, assignees; a checkbox on hover for multi-select. */
export const GithubCard = memo(function GithubCard({ item, selected, goal, onToggle, onOpen }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? onToggle(item.id, e.shiftKey) : onOpen(item.id))}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(item.id)
        if (e.key === " ") {
          e.preventDefault()
          onToggle(item.id, e.shiftKey)
        }
      }}
      className={cn(
        "group relative cursor-pointer rounded-xl border bg-card p-2.5 text-sm shadow-xs transition-colors outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/40",
        selected && "border-primary/60 bg-primary/5 ring-1 ring-primary/40"
      )}
    >
      <div
        className={cn("absolute top-2 left-2 transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}
        onClick={(e) => {
          e.stopPropagation()
          onToggle(item.id, e.shiftKey)
        }}
      >
        <Checkbox checked={selected} aria-label={`Select ${itemRef(item)}`} className="bg-background" />
      </div>

      <div className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground transition-[padding]", selected ? "pl-6" : "group-hover:pl-6")}>
        <ItemTypeIcon item={item} />
        <span className="truncate font-mono">{itemRef(item)}</span>
        {goal && <GoalBadge goal={goal} className="ml-auto" />}
      </div>

      <p className="mt-1 line-clamp-2 leading-snug">{item.title}</p>

      {item.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.labels.slice(0, MAX_LABELS).map((l) => <LabelPill key={l.name} label={l} />)}
          {item.labels.length > MAX_LABELS && <span className="text-[10px] text-muted-foreground">+{item.labels.length - MAX_LABELS}</span>}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        {item.priority && (
          <span className="flex max-w-28 items-center gap-1 truncate" title="Priority">
            <FlagIcon className="size-3 shrink-0" /> {item.priority}
          </span>
        )}
        {item.iteration && (
          <span className="flex max-w-28 items-center gap-1 truncate" title="Sprint">
            <CalendarRangeIcon className="size-3 shrink-0" /> {item.iteration}
          </span>
        )}
        {item.linkedPrs.length > 0 && (
          <span className="flex items-center gap-0.5" title={`${item.linkedPrs.length} linked pull request(s)`}>
            <GitPullRequestIcon className="size-3" /> {item.linkedPrs.length}
          </span>
        )}
        <Avatars users={item.assignees} className="ml-auto" />
      </div>
    </div>
  )
})
