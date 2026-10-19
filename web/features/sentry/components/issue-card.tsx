"use client"

import { memo } from "react"
import { BotIcon, FileCodeIcon, FlagIcon, FlameIcon, UsersIcon, ZapIcon } from "lucide-react"
import type { Goal, SentryIssue } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToneBadge } from "@/components/kit/badge"
import { TONE_CLASS } from "@/components/kit/tone"
import { GoalBadge } from "@/features/github/components/goal-badge"
import { levelMeta, PRIORITY_TONE, SUBSTATUS_META } from "../constants"
import { compact, initials } from "../lib/format"
import { Sparkline } from "./sparkline"

export interface IssueCardProps {
  issue: SentryIssue
  selected: boolean
  /** Anything is selected: checkboxes stay visible. */
  selecting: boolean
  /** Shown in the Inspector right now. */
  open: boolean
  goal?: Goal
  onToggle: (id: string, range: boolean) => void
  onOpen: (id: string) => void
  /** Open details scrolled to the hand-off form. */
  onFix: (id: string) => void
}

/** "L3-ANGULAR-SUNRISE-PARTNERPORTAL-4X" → "4X" (the project is shown next to it). */
export const shortRef = (shortId: string) => shortId.split("-").pop() || shortId

/** One Sentry issue as a card: what broke, where, how often, and who it hits. */
export const IssueCard = memo(function IssueCard({ issue: i, selected, selecting, open, goal, onToggle, onOpen, onFix }: IssueCardProps) {
  const level = levelMeta(i.level)
  const sub = i.substatus ? SUBSTATUS_META[i.substatus] : undefined
  const headline = i.type ?? level.label
  const message = i.type ? i.value || i.title : i.title
  const where = i.culprit || i.filename
  const last24 = i.stats.reduce((a, b) => a + b, 0)
  const showCheck = selected || selecting

  return (
    <li
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-xs",
        selected && "border-brand/60 ring-2 ring-brand/15",
        open && !selected && "border-foreground/25 shadow-xs"
      )}
    >
      {/* The whole card opens the details; checkbox and Fix sit above it. */}
      <button
        type="button"
        onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? onToggle(i.id, e.shiftKey) : onOpen(i.id))}
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label={`Open ${i.shortId}: ${i.title}`}
      />

      <div className="pointer-events-none relative flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-1.5">
          <ToneBadge tone={level.tone} size="sm" dot>
            {level.label}
          </ToneBadge>
          {sub && (
            <ToneBadge tone={sub.tone} size="sm">
              {sub.label}
            </ToneBadge>
          )}
          {i.unhandled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn(TONE_CLASS.danger, "tone-soft pointer-events-auto grid size-5 place-items-center rounded-full border")} aria-label="Unhandled">
                  <ZapIcon className="size-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent>Unhandled: it crashed through without being caught</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="pointer-events-auto ml-auto text-xs text-muted-foreground tabular-nums">{timeAgo(Date.parse(i.lastSeen))}</span>
            </TooltipTrigger>
            <TooltipContent>
              Last seen {new Date(i.lastSeen).toLocaleString()}
              <br />
              First seen {new Date(i.firstSeen).toLocaleString()} ({timeAgo(Date.parse(i.firstSeen))})
            </TooltipContent>
          </Tooltip>
          <Checkbox
            checked={selected}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(i.id, e.shiftKey)
            }}
            aria-label={`Select ${i.shortId}`}
            className={cn(
              "pointer-events-auto bg-surface transition-opacity",
              !showCheck && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            )}
          />
        </div>

        <div className="min-w-0 space-y-1">
          <p className="truncate font-mono text-sm font-semibold">{headline}</p>
          <p className="line-clamp-2 text-sm leading-snug text-foreground/75" title={message}>
            {message}
          </p>
        </div>

        {where && (
          <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <FileCodeIcon className="size-3.5 shrink-0" />
            <span className="truncate">{where}</span>
          </p>
        )}

        <div className="mt-auto">
          {last24 > 0 ? (
            <Sparkline values={i.stats} className="h-8 w-full text-muted-foreground/60" />
          ) : (
            <p className="flex h-8 items-end text-xs text-muted-foreground/80">Quiet in the last 24 h</p>
          )}
        </div>
      </div>

      <div className="pointer-events-none relative flex items-center gap-3 border-t px-4 py-2.5 text-xs">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="pointer-events-auto flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 rounded-md border bg-sunken px-1.5 py-px font-mono text-xs font-semibold">{shortRef(i.shortId)}</span>
              <span className="truncate text-muted-foreground">{i.project.name || i.project.slug}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="font-mono">{i.shortId}</TooltipContent>
        </Tooltip>

        <div className="ml-auto flex shrink-0 items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1 tabular-nums" title={`${i.count} events in this period`}>
            <FlameIcon className="size-3.5" />
            <span className="font-medium text-foreground">{compact(i.count)}</span>
          </span>
          <span className="flex items-center gap-1 tabular-nums" title={`${i.userCount} users affected`}>
            <UsersIcon className="size-3.5" />
            <span className="font-medium text-foreground">{compact(i.userCount)}</span>
          </span>
          {i.priority && (
            <span className={cn(TONE_CLASS[PRIORITY_TONE[i.priority] ?? "neutral"], "tone-text flex items-center gap-1 capitalize")} title={`${i.priority} priority`}>
              <FlagIcon className="size-3.5" />
            </span>
          )}
          {i.assignee && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="pointer-events-auto grid size-6 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground">{initials(i.assignee.name)}</span>
              </TooltipTrigger>
              <TooltipContent>Assigned to {i.assignee.type === "team" ? `team ${i.assignee.name}` : i.assignee.name}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {goal ? (
          <span className="pointer-events-auto relative shrink-0">
            <GoalBadge goal={goal} />
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="pointer-events-auto relative -mr-2 h-7 shrink-0 rounded-full px-2.5 text-muted-foreground hover:text-foreground"
            onClick={() => onFix(i.id)}
            aria-label={`Fix ${i.shortId} with a bot`}
          >
            <BotIcon data-icon="inline-start" /> Fix
          </Button>
        )}
      </div>
    </li>
  )
})
