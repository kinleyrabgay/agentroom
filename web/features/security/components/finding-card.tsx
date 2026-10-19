"use client"

import { useState } from "react"
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react"
import { FindingStatus, type SecurityFinding } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { useAppStore } from "@/lib/store/app-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Markdown } from "@/components/shared/markdown"
import { ActorChip } from "@/features/audit/components/actor-chip"
import { CATEGORY_META, SEVERITY_META, SOURCE_LABEL, STATUS_META } from "../constants"
import { location } from "../lib/findings"
import { ResolveDialog, type ResolveMode } from "./resolve-dialog"
import { SeverityBadge } from "./severity-badge"

/** One finding: severity stripe, what and where, redacted snippet, explanation, and the human's decision. */
export function FindingCard({ finding: f, now, showGoal = true }: { finding: SecurityFinding; now: number; showGoal?: boolean }) {
  const bot = useAppStore((s) => (f.botId ? s.bots.find((b) => b.id === f.botId) : undefined))
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const [detailOpen, setDetailOpen] = useState(false)
  const [resolving, setResolving] = useState<ResolveMode | null>(null)
  const sev = SEVERITY_META[f.severity]
  const cat = CATEGORY_META[f.category] ?? CATEGORY_META.other
  const CatIcon = cat.icon
  const status = STATUS_META[f.status]
  const StatusIcon = status.icon
  const where = location(f)
  const open = f.status === FindingStatus.Open

  return (
    <li className={cn("relative overflow-hidden rounded-xl border bg-card", !open && "opacity-80")}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", sev.stripe)} />
      <div className="space-y-2.5 py-3 pr-4 pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <Badge variant="outline" className="gap-1 font-normal">
            <CatIcon className="size-3" /> {cat.label}
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {SOURCE_LABEL[f.source] ?? f.source}
          </Badge>
          {!open && (
            <Badge variant="outline" className="gap-1 font-normal">
              <StatusIcon className="size-3" /> {status.label}
            </Badge>
          )}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {showGoal && f.goalId && (
              <button
                onClick={() => showOnTasks({ goalId: f.goalId })}
                className="rounded-md border px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted hover:text-foreground"
                title="Open this goal in Tasks"
              >
                {f.goalId}
                {f.taskId && ` · ${f.taskId}`}
              </button>
            )}
            {bot && <BotAvatar bot={bot} className="size-5 rounded-md text-[10px]" />}
            <time dateTime={f.ts} title={new Date(f.ts).toLocaleString()} className="tabular-nums">
              {timeAgo(Date.parse(f.ts), now)}
            </time>
          </span>
        </div>

        <h3 className="text-sm font-medium">{f.title}</h3>

        {where && <CopyLocation text={where} />}

        {f.snippet && (
          <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px] break-all whitespace-pre-wrap">{f.snippet}</pre>
        )}

        {f.detail && (
          <div>
            <button
              onClick={() => setDetailOpen(!detailOpen)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={detailOpen}
            >
              <ChevronRightIcon className={cn("size-3.5 transition-transform", detailOpen && "rotate-90")} />
              Why it matters and how to fix it
            </button>
            {detailOpen && (
              <div className="mt-1.5 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                <Markdown text={f.detail} />
              </div>
            )}
          </div>
        )}

        {open ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setResolving("approved")}>
              Approve risk
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResolving("dismissed")}>
              Dismiss as false positive
            </Button>
            <span className={cn("ml-auto text-[11px]", sev.text)}>
              <code className="font-mono">{f.rule}</code>
            </span>
          </div>
        ) : (
          (f.resolvedBy || f.note) && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <StatusIcon className="size-3.5" />
              <span>{status.label}</span>
              {f.resolvedBy && <ActorChip actor={f.resolvedBy} />}
              {f.resolvedAt && <span>{timeAgo(Date.parse(f.resolvedAt), now)}</span>}
              {f.note && <span className="w-full text-foreground/80">“{f.note}”</span>}
            </div>
          )
        )}
      </div>
      {resolving && <ResolveDialog finding={f} mode={resolving} onClose={() => setResolving(null)} />}
    </li>
  )
}

function CopyLocation({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — the text is still selectable
    }
  }
  return (
    <div className="flex items-center gap-1.5">
      <code className="truncate font-mono text-xs text-muted-foreground">{text}</code>
      <Button variant="ghost" size="icon-xs" onClick={copy} title="Copy path" aria-label="Copy path">
        {copied ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
      </Button>
    </div>
  )
}
