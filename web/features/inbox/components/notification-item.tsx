"use client"

import { NotificationKind, type Notification } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { NOTIFICATION_META } from "../lib/meta"
import { openNotificationTarget } from "../lib/route"
import { QuestionAnswer } from "./question-answer"
import { plainText } from "@shared"

export function NotificationItem({
  n,
  onNavigate,
}: {
  n: Notification
  onNavigate: () => void
}) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === n.botId))
  const meta = NOTIFICATION_META[n.kind]
  const Icon = meta.icon
  const isQuestion = n.kind === NotificationKind.Question

  return (
    <li
      className={cn("relative flex gap-3 px-3 py-3", !n.read && "bg-muted/40")}
    >
      {!n.read && (
        <span
          className="absolute top-4 left-1 size-1.5 rounded-full bg-primary"
          aria-label="Unread"
        />
      )}
      <span className="relative mt-0.5 shrink-0">
        {bot ? (
          <BotAvatar bot={bot} className="size-7 rounded-lg text-sm" />
        ) : (
          <span className="grid size-7 place-items-center rounded-lg bg-muted" />
        )}
        <Icon
          className={cn(
            "absolute -right-1 -bottom-1 size-3.5 rounded-full bg-popover",
            meta.tone
          )}
        />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 text-sm leading-snug font-medium">
            {n.title}
          </p>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {timeAgo(n.ts)}
          </span>
        </div>
        {n.body && (
          <p className="line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {plainText(n.body, 220)}
          </p>
        )}
        {isQuestion && <QuestionAnswer n={n} />}
        {meta.action && !isQuestion && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              openNotificationTarget(n)
              onNavigate()
            }}
          >
            {meta.action}
          </Button>
        )}
      </div>
    </li>
  )
}
