"use client"

import { NotificationKind, plainText, type Notification } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { TONE_CLASS } from "@/components/kit/tone"
import { NOTIFICATION_META } from "../lib/meta"
import { openNotificationTarget } from "../lib/route"
import { QuestionAnswer } from "./question-answer"

/** One notification: who, what, when, and the one thing to do about it. */
export function NotificationItem({ n, onNavigate, className }: { n: Notification; onNavigate?: () => void; className?: string }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === n.botId))
  const meta = NOTIFICATION_META[n.kind]
  const Icon = meta.icon
  const isQuestion = n.kind === NotificationKind.Question

  return (
    <li className={cn("relative flex gap-3 px-4 py-3", !n.read && "bg-sunken/70", className)}>
      {!n.read && <span className="absolute top-[18px] left-1.5 size-1.5 rounded-full bg-brand" aria-label="Unread" />}
      <span className="relative mt-0.5 shrink-0">
        {bot ? <BotAvatar bot={bot} className="size-8 rounded-lg text-sm" /> : <span className="grid size-8 place-items-center rounded-lg bg-muted" />}
        <span className={cn(TONE_CLASS[meta.tone], "tone-text absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-popover ring-2 ring-popover")}>
          <Icon className="size-3" aria-hidden />
        </span>
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 text-sm leading-snug font-medium">{n.title}</p>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{timeAgo(n.ts)}</span>
        </div>
        {n.body && <p className="line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{plainText(n.body, 220)}</p>}
        {isQuestion && <QuestionAnswer n={n} />}
        {meta.action && !isQuestion && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              openNotificationTarget(n)
              onNavigate?.()
            }}
          >
            {meta.action}
          </Button>
        )}
      </div>
    </li>
  )
}
