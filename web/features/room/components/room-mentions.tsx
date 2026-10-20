"use client"

import { AtSignIcon, CheckCheckIcon, MessageSquareIcon } from "lucide-react"
import { GoalTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { roomApi } from "../lib/room-api"
import { useRoomStore } from "../lib/room-store"

const SHOWN = 8

/** Inbox: comments and @mentions meant for you (each person sees only their own). */
export function RoomMentions() {
  const notifications = useRoomStore((s) => s.notifications)
  const goals = useAppStore((s) => s.goals)
  const recent = [...notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, SHOWN)
  const unread = notifications.filter((n) => !n.read).length
  if (!recent.length) return null

  const open = (goalId: string, id: string) => {
    useAppStore.getState().showOnTasks({ goalId })
    useAppStore.getState().setGoalTab(GoalTab.Discussion)
    read([id])
  }

  return (
    <section className="space-y-2" aria-labelledby="inbox-for-you">
      <div className="flex items-center gap-2">
        <h2 id="inbox-for-you" className="text-sm font-medium">
          For you
        </h2>
        {unread > 0 && <span className="text-sm text-muted-foreground tabular-nums">{unread} new</span>}
        {unread > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => read()}>
            <CheckCheckIcon data-icon="inline-start" /> Mark read
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {recent.map((n) => {
          const goal = goals.find((g) => g.id === n.goalId)
          const Icon = n.kind === "mention" ? AtSignIcon : MessageSquareIcon
          return (
            <li key={n.id}>
              <button
                onClick={() => open(n.goalId, n.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", n.read ? "text-muted-foreground" : "text-brand")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    <span className="font-medium">{n.from}</span> {n.kind === "mention" ? "mentioned you on" : "commented on"}{" "}
                    <span className="font-mono text-xs text-muted-foreground">{n.goalId}</span> {goal?.title}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{n.text}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(Date.parse(n.createdAt))}</span>
                {!n.read && <span className="tone-brand tone-solid mt-1.5 size-2 shrink-0 rounded-full" aria-label="Unread" />}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function read(ids?: string[]) {
  roomApi.markRead(ids).catch(() => {})
  const set = ids ? new Set(ids) : null
  useRoomStore.setState((s) => ({ notifications: s.notifications.map((n) => (!set || set.has(n.id) ? { ...n, read: true } : n)) }))
}
