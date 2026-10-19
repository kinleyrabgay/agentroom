"use client"

import { useEffect, useMemo, useState } from "react"
import { BellIcon, CheckCheckIcon, InboxIcon } from "lucide-react"
import { isToday } from "@/lib/time"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/kit/state-view"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { markRead } from "../lib/actions"
import { needsAnswer } from "../lib/route"
import { AlertSettings } from "./alert-settings"
import { NotificationItem } from "./notification-item"

/** Top-bar bell: recent notifications (plan reviews, questions, blocks, results). The Inbox page is where things get done. */
export function InboxButton() {
  const notifications = useAppStore((s) => s.notifications)
  const [open, setOpen] = useState(false)

  const sorted = useMemo(
    () => [...notifications].sort((a, b) => b.ts - a.ts),
    [notifications]
  )
  const unread = notifications.filter((n) => !n.read).length
  const today = sorted.filter((n) => isToday(n.ts))
  const earlier = sorted.filter((n) => !isToday(n.ts))

  // Opening the inbox reads everything except questions still waiting for an answer.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(
      () =>
        markRead(
          notifications
            .filter((n) => !n.read && !needsAnswer(n))
            .map((n) => n.id)
        ),
      1200
    )
    return () => clearTimeout(t)
  }, [open, notifications])

  const group = (label: string, items: typeof sorted) =>
    items.length > 0 && (
      <section>
        <h4 className="sticky top-0 z-10 bg-popover/95 px-4 pt-2.5 pb-1 text-xs font-medium text-muted-foreground backdrop-blur">
          {label}
        </h4>
        <ul className="divide-y">
          {items.map((n) => (
            <NotificationItem
              key={n.id}
              n={n}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </ul>
      </section>
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-brand-foreground tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-96 overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <span className="text-xs text-muted-foreground">
              {unread} unread
            </span>
          )}
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            disabled={!unread}
            onClick={() =>
              markRead(notifications.filter((n) => !n.read).map((n) => n.id))
            }
          >
            <CheckCheckIcon data-icon="inline-start" /> Mark all read
          </Button>
        </div>
        <div className="max-h-[min(70vh,520px)] overflow-y-auto">
          {sorted.length ? (
            <>
              {group("Today", today)}
              {group("Earlier", earlier)}
            </>
          ) : (
            <EmptyState
              compact
              icon={InboxIcon}
              title="No notifications yet"
              description="Plan reviews, questions from bots and finished goals show up here."
            />
          )}
        </div>
        <AlertSettings onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
