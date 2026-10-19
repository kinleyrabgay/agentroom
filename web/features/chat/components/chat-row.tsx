import { CheckIcon, CircleAlertIcon } from "lucide-react"
import type { Bot } from "@shared"
import { cn } from "@/lib/utils"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Markdown } from "@/components/shared/markdown"
import type { TranscriptItem } from "../lib/transcript"
import { ToolGroup } from "./tool-group"
import { MessageAttachments } from "@/features/attachments/components/message-attachments"

/** Text sent when a message is only attachments; not worth a bubble. */
const ATTACHMENTS_ONLY = "(see attachments)"

export function ChatRow({ item, bot, nameOf, showAvatar }: {
  item: TranscriptItem
  bot: Bot
  nameOf: (id: string) => string
  showAvatar: boolean
}) {
  if (item.kind === "user") {
    return (
      <div className="ml-10 flex flex-col items-end gap-1">
        <span className="text-[11px] text-muted-foreground">{nameOf(item.from)}</span>
        {item.text && !(item.attachments.length && item.text === ATTACHMENTS_ONLY) && (
          <div className="max-w-full rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
            {item.text}
          </div>
        )}
        <MessageAttachments attachments={item.attachments} />
      </div>
    )
  }

  return (
    <div className="flex gap-2.5">
      <div className="w-6 shrink-0">{showAvatar && <BotAvatar bot={bot} className="size-6 rounded-md text-xs" />}</div>
      <div className="min-w-0 flex-1">
        {item.kind === "text" && (
          <div className={cn(item.live && "streaming")}>
            <Markdown text={item.text} />
          </div>
        )}
        {item.kind === "tools" && <ToolGroup steps={item.steps} live={item.live} />}
        {item.kind === "done" && (
          <div className={cn("flex items-center gap-1.5 text-[11px]", item.ok ? "text-muted-foreground" : "text-destructive")}>
            {item.ok ? <CheckIcon className="size-3" /> : <CircleAlertIcon className="size-3" />}
            {item.turns} {item.turns === 1 ? "turn" : "turns"} · {(item.durationMs / 1000).toFixed(1)}s · ${item.costUsd.toFixed(4)}
          </div>
        )}
        {item.kind === "error" && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {item.message}
          </div>
        )}
      </div>
    </div>
  )
}
