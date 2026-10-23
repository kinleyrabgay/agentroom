"use client"

import { useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, CornerDownRightIcon, GaugeIcon, Loader2Icon, PaperclipIcon, PencilIcon, PlayIcon, XIcon } from "lucide-react"
import { ClientMessageType, QueueHoldReason, type Bot, type BotQueue, type QueuedMessage } from "@shared"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

/** Sent by "Continue now" after a usage limit. */
const CONTINUE_PROMPT = "Continue where you left off."

const HOLD_TEXT: Record<QueueHoldReason, string> = {
  [QueueHoldReason.Failed]: "Paused after the run failed",
  [QueueHoldReason.Stopped]: "Paused after you stopped the run",
  [QueueHoldReason.Limited]: "Paused until the usage limit resets",
  [QueueHoldReason.Restart]: "Paused after AgentRoom restarted",
}

/**
 * Above the composer: messages you sent while the bot was busy (sent in order when its run ends
 * cleanly), steers on their way into the running turn, and why the queue is paused.
 */
export function QueuePanel({ bot }: { bot: Bot }) {
  const queue = useAppStore((s) => s.queues[bot.id])
  if (!queue) return null
  const limited = queue.hold?.reason === QueueHoldReason.Limited
  if (!queue.items.length && !queue.steers.length && !limited) return null

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-xl border bg-sunken/60 text-xs" aria-label="Queued messages">
      {limited && <LimitBanner bot={bot} queue={queue} />}
      {queue.steers.map((s) => (
        <div key={s.id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />
          <span className="shrink-0 text-muted-foreground">Steering…</span>
          <span className="truncate">{firstLine(s.text)}</span>
        </div>
      ))}
      {queue.items.length > 0 && (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="font-medium">Queued {queue.items.length}</span>
            <span className="truncate text-muted-foreground">
              {queue.hold ? HOLD_TEXT[queue.hold.reason] : `Sends when ${bot.name} finishes`}
            </span>
            {queue.hold && !limited && (
              <Button size="xs" variant="outline" className="ml-auto" onClick={() => send({ type: ClientMessageType.QueueResume, botId: bot.id })}>
                <PlayIcon data-icon="inline-start" /> Resume
              </Button>
            )}
          </div>
          <ol className="border-t">
            {queue.items.map((m, i) => (
              <QueueRow key={m.id} bot={bot} item={m} index={i} count={queue.items.length} />
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function QueueRow({ bot, item, index, count }: { bot: Bot; item: QueuedMessage; index: number; count: number }) {
  const [editing, setEditing] = useState<string | null>(null)
  const move = (to: number) => send({ type: ClientMessageType.QueueMove, botId: bot.id, id: item.id, index: to })
  const save = () => {
    if (editing?.trim()) send({ type: ClientMessageType.QueueEdit, botId: bot.id, id: item.id, text: editing })
    setEditing(null)
  }

  if (editing !== null) {
    return (
      <li className="space-y-1.5 border-b px-3 py-2 last:border-b-0">
        <Textarea
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              save()
            } else if (e.key === "Escape") setEditing(null)
          }}
          rows={2}
          className="min-h-0 text-xs"
          aria-label="Edit queued message"
        />
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button size="xs" onClick={save}>Save</Button>
        </div>
      </li>
    )
  }

  return (
    <li className="group flex items-center gap-2 border-b px-3 py-1 last:border-b-0">
      <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate" title={item.text}>{firstLine(item.text)}</span>
      {!!item.attachments?.length && (
        <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground tabular-nums">
          <PaperclipIcon className="size-3" /> {item.attachments.length}
        </span>
      )}
      <div className="flex shrink-0 items-center opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button size="icon-xs" variant="ghost" title="Send now: into the running turn if it can take it, else next" aria-label="Send now" onClick={() => send({ type: ClientMessageType.QueueSendNow, botId: bot.id, id: item.id })}>
          <CornerDownRightIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Edit" onClick={() => setEditing(item.text)}>
          <PencilIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => move(index - 1)}>
          <ArrowUpIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={index === count - 1} onClick={() => move(index + 1)}>
          <ArrowDownIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Remove" onClick={() => send({ type: ClientMessageType.QueueRemove, botId: bot.id, id: item.id })}>
          <XIcon />
        </Button>
      </div>
    </li>
  )
}

/** The bot hit its plan's usage limit: when it resets, resume on its own, or carry on now. */
function LimitBanner({ bot, queue }: { bot: Bot; queue: BotQueue }) {
  const until = queue.hold?.until
  const resume = () => {
    send({ type: ClientMessageType.QueueResume, botId: bot.id })
    if (!queue.items.length) send({ type: ClientMessageType.Send, botId: bot.id, text: CONTINUE_PROMPT })
  }
  return (
    <div className="tone-warning tone-bar flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2 last:border-b-0">
      <GaugeIcon className="tone-text size-3.5 shrink-0" />
      <span className="font-medium">Usage limit reached</span>
      <span className="text-muted-foreground">{until ? `Resets ${formatReset(until)}` : "Reset time unknown"}</span>
      <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
        <Switch
          size="sm"
          checked={queue.resumeAtReset}
          disabled={!until}
          onCheckedChange={(on) => send({ type: ClientMessageType.ResumeAtReset, botId: bot.id, on })}
        />
        Resume at reset
      </label>
      <Button size="xs" variant="outline" onClick={resume}>
        Continue now
      </Button>
    </div>
  )
}

const firstLine = (text: string) => text.trim().split("\n")[0] || "(attachments)"

function formatReset(at: number) {
  const d = new Date(at)
  const today = new Date()
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`
}
