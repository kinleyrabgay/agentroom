"use client"

import { useAppStore } from "@/lib/store/app-store"
import type { TaskLogEntry } from "@shared"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { timeAgo } from "@/lib/time"

/** Progress notes left by bots and the workflow engine, oldest first. */
export function TaskLog({ entries }: { entries: TaskLogEntry[] }) {
  const bots = useAppStore((s) => s.bots)
  if (!entries.length)
    return <p className="text-xs text-muted-foreground">No activity yet.</p>

  return (
    <ol className="relative space-y-3 border-l pl-4">
      {entries.map((e, i) => {
        const bot = bots.find((b) => b.id === e.by)
        return (
          <li key={i} className="relative">
            <span className="absolute top-0.5 -left-[25px]">
              {bot ? (
                <BotAvatar bot={bot} className="size-4.5 rounded text-[9px]" />
              ) : (
                <span className="block size-2 translate-x-[5px] translate-y-1 rounded-full bg-muted-foreground/50" />
              )}
            </span>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="font-medium">
                {bot?.name ?? (e.by === "human" ? "You" : e.by)}
              </span>
              <span className="text-muted-foreground">
                {timeAgo(Date.parse(e.ts))}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {e.text}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
