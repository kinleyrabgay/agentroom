"use client"

import { useState } from "react"
import { ArrowUpIcon, MessageSquareIcon, RocketIcon } from "lucide-react"
import { toast } from "sonner"
import { ClientMessageType } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab } from "@/lib/constants"
import { goalApi } from "@/lib/api/endpoints"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BotAvatar } from "@/components/shared/bot-avatar"

const Mode = { Goal: "goal", Chat: "chat" } as const
type Mode = (typeof Mode)[keyof typeof Mode]

/**
 * Goal mode starts a planned goal run (Planner → your review → build → QA).
 * Chat mode sends a one-off message to the top-of-tree bot (Team Lead by default).
 */
export function CommandBar() {
  const lead = useAppStore((s) => s.bots.find((b) => !b.reportsTo))
  const select = useAppStore((s) => s.select)
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const [mode, setMode] = useState<Mode>(Mode.Goal)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  if (!lead) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    if (mode === Mode.Chat) {
      send({ type: ClientMessageType.Send, botId: lead.id, text: value })
      setText("")
      select(lead.id, BotTab.Chat)
      return
    }
    setBusy(true)
    try {
      const goal = await goalApi.create(value)
      setText("")
      showOnTasks({ goalId: goal.id })
      toast.success(`${goal.id} started`, {
        description: "The Planner is breaking it into tasks for your review.",
      })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const modeButton = (m: Mode, label: string, Icon: typeof RocketIcon) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={cn(
        "flex h-7 items-center gap-1 rounded-full px-2.5 text-xs transition-colors",
        mode === m
          ? "bg-background font-medium shadow-xs"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )

  return (
    <div className="border-t bg-background/80 p-3 backdrop-blur">
      <form
        onSubmit={submit}
        className="mx-auto flex max-w-3xl items-center gap-2 rounded-full border bg-card p-1.5 pl-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30"
      >
        <BotAvatar bot={lead} className="size-7 rounded-full text-sm" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            mode === Mode.Goal
              ? "Give the team a goal. The Planner drafts tasks for your review…"
              : `Message ${lead.name}…`
          }
          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div
          className="flex shrink-0 items-center rounded-full bg-muted p-0.5"
          role="group"
          aria-label="Send as"
        >
          {modeButton(Mode.Goal, "Goal", RocketIcon)}
          {modeButton(Mode.Chat, "Chat", MessageSquareIcon)}
        </div>
        <Button
          type="submit"
          size="icon-sm"
          className="rounded-full"
          disabled={!text.trim() || busy}
          title={mode === Mode.Goal ? "Start goal" : `Send to ${lead.name}`}
        >
          <ArrowUpIcon />
        </Button>
      </form>
    </div>
  )
}
