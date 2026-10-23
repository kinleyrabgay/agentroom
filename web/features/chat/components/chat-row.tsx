import { useState } from "react"
import { CheckIcon, ChevronDownIcon, CircleAlertIcon } from "lucide-react"
import type { Bot } from "@shared"
import { cn } from "@/lib/utils"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Markdown } from "@/components/shared/markdown"
import type { TranscriptItem } from "../lib/transcript"
import { ToolGroup } from "./tool-group"
import { ActivityFold } from "./activity-fold"
import { TurnChangesCard } from "./turn-changes-card"
import { Callout } from "@/components/kit/callout"
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
        <span className="text-xs text-muted-foreground">{nameOf(item.from)}</span>
        {item.text && !(item.attachments.length && item.text === ATTACHMENTS_ONLY) && (
          <MessageBubble text={item.text} fromBot={item.from !== "human"} />
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
        {item.kind === "activity" && <ActivityFold item={item} />}
        {item.kind === "changes" && <TurnChangesCard files={item.files} skipped={item.skipped} />}
        {item.kind === "done" && (
          <div className={cn("flex items-center gap-1.5 text-xs tabular-nums", item.ok ? "text-muted-foreground" : "tone-danger tone-text")}>
            {item.ok ? <CheckIcon className="size-3" /> : <CircleAlertIcon className="size-3" />}
            {item.turns} {item.turns === 1 ? "turn" : "turns"} · {(item.durationMs / 1000).toFixed(1)}s · ${item.costUsd.toFixed(4)}
          </div>
        )}
        {item.kind === "error" && (
          <Callout tone="danger" className="text-xs">
            {item.message}
          </Callout>
        )}
      </div>
    </div>
  )
}

/** Longer than this, a message starts collapsed (bot briefs can be pages long). */
const LONG_CHARS = 900
const LONG_LINES = 14

/**
 * A message sent to this bot. Yours: the solid bubble. From another bot (a delegated brief):
 * a quieter card rendered as markdown. Long messages start collapsed.
 */
function MessageBubble({ text, fromBot }: { text: string; fromBot: boolean }) {
  const lines = text.split("\n").length
  const long = text.length > LONG_CHARS || lines > LONG_LINES
  const [open, setOpen] = useState(!long)

  return (
    <div
      className={cn(
        "max-w-full overflow-hidden rounded-2xl rounded-tr-md text-sm",
        fromBot ? "border bg-sunken text-foreground" : "bg-primary text-primary-foreground"
      )}
    >
      {/* Collapsed: the text fades out under a mask (no coloured overlay, works on any fill). */}
      <div
        className={cn(
          "px-3.5 py-2",
          !fromBot && "whitespace-pre-wrap",
          !open && "max-h-56 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]"
        )}
      >
        {fromBot ? <Markdown text={text} /> : text}
      </div>
      {long && (
        <div className="flex justify-center px-3 pb-2">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              fromBot ? "border bg-surface text-foreground hover:bg-accent" : "bg-primary-foreground/15 hover:bg-primary-foreground/25"
            )}
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            {open ? "Show less" : `Show full message · ${lines} lines`}
          </button>
        </div>
      )}
    </div>
  )
}
