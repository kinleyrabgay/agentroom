"use client"

import { useState } from "react"
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react"
import type { AuditEntry } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { useAppStore } from "@/lib/store/app-store"
import { ToneBadge } from "@/components/kit/badge"
import { Button } from "@/components/ui/button"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { KIND_META, MONO_KINDS } from "../lib/meta"
import { ActorChip } from "./actor-chip"

/** One audit entry; click to expand its structured detail. */
export function AuditRow({ entry, now }: { entry: AuditEntry; now: number }) {
  const [open, setOpen] = useState(false)
  const bot = useAppStore((s) => (entry.botId ? s.bots.find((b) => b.id === entry.botId) : undefined))
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const kind = KIND_META[entry.kind] ?? KIND_META.command
  const KindIcon = kind.icon
  const ts = Date.parse(entry.ts)

  return (
    <li className={cn("border-b last:border-b-0", open && "bg-sunken/60")}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(!open))}
        className="grid cursor-pointer grid-cols-[16px_88px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 outline-none hover:bg-accent/60 focus-visible:bg-accent md:grid-cols-[16px_88px_132px_minmax(0,1fr)_auto]"
      >
        <ChevronRightIcon className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        <time dateTime={entry.ts} title={new Date(ts).toLocaleString()} className="text-xs text-muted-foreground tabular-nums">
          {timeAgo(ts, now)}
        </time>
        <span className="hidden md:flex">
          <ToneBadge tone="neutral" icon={KindIcon} className="font-normal">
            {kind.label}
          </ToneBadge>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <KindIcon className="size-3.5 shrink-0 text-muted-foreground md:hidden" />
          <span className={cn("truncate text-sm", MONO_KINDS.has(entry.kind) && "font-mono text-xs")} title={entry.summary}>
            {entry.summary}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {entry.goalId && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                showOnTasks({ goalId: entry.goalId })
              }}
              className="hidden rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:inline"
              aria-label={`Open ${entry.goalId} in Work`}
            >
              {entry.goalId}
              {entry.taskId && ` · ${entry.taskId}`}
            </button>
          )}
          {bot && <BotAvatar bot={bot} className="size-5 rounded-md text-[10px]" />}
          <ActorChip actor={entry.actor} />
          {entry.decision && (
            <ToneBadge tone={entry.decision === "denied" ? "danger" : "success"} dot>
              {entry.decision === "denied" ? "Denied" : "Allowed"}
            </ToneBadge>
          )}
        </span>
      </div>
      {open && <AuditDetail entry={entry} />}
    </li>
  )
}

function AuditDetail({ entry }: { entry: AuditEntry }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(entry, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="px-4 pb-3 pl-11">
      <div className="relative rounded-lg border bg-surface">
        <Button size="icon-xs" variant="ghost" className="absolute top-1.5 right-1.5" onClick={copy} aria-label="Copy entry as JSON">
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
        <pre className="max-h-80 overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{json}</pre>
      </div>
    </div>
  )
}
