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
import { useAttachments } from "@/features/attachments/hooks/use-attachments"
import { pastedFiles, useFileDrop } from "@/features/attachments/hooks/use-file-drop"
import { AttachButton } from "@/features/attachments/components/attach-button"
import { AttachmentTray } from "@/features/attachments/components/attachment-tray"
import { DropOverlay } from "@/features/attachments/components/drop-overlay"

const Mode = { Goal: "goal", Chat: "chat" } as const
type Mode = (typeof Mode)[keyof typeof Mode]

const FILES_ONLY = "(see attachments)"

/**
 * Goal mode starts a planned goal run (Planner → your review → build → QA).
 * Chat mode sends a one-off message to the top-of-tree bot (Team Lead by default).
 * Screenshots and files can be pasted, dropped or attached in both modes.
 *
 * `floating`: a centered pill over the full-page canvas (Team view) instead of a bottom band.
 */
export function CommandBar({ floating = false }: { floating?: boolean }) {
  const lead = useAppStore((s) => s.bots.find((b) => !b.reportsTo))
  const select = useAppStore((s) => s.select)
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const [mode, setMode] = useState<Mode>(Mode.Goal)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const files = useAttachments()
  const drop = useFileDrop(files.add)
  if (!lead) return null

  const hasContent = !!text.trim() || files.readyIds.length > 0
  const canSend = hasContent && !busy && !files.uploading

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    const value = text.trim() || FILES_ONLY
    const attachments = files.readyIds.length ? files.readyIds : undefined
    if (mode === Mode.Chat) {
      send({ type: ClientMessageType.Send, botId: lead.id, text: value, attachments })
      setText("")
      files.clear()
      select(lead.id, BotTab.Chat)
      return
    }
    if (!text.trim()) {
      toast.error("Describe the goal — attachments alone aren't enough to plan from.")
      return
    }
    setBusy(true)
    try {
      const goal = await goalApi.create(value, undefined, undefined, attachments)
      setText("")
      files.clear()
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
        mode === m ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )

  return (
    <div className={cn(floating ? "pointer-events-none px-4 pb-4" : "border-t bg-background/80 p-3 backdrop-blur")}>
      <div className="pointer-events-auto mx-auto max-w-3xl">
        {files.drafts.length > 0 && (
          <div className="mb-2 rounded-2xl border bg-card/95 p-2 shadow-sm backdrop-blur">
            <AttachmentTray controller={files} />
          </div>
        )}
        <form
          onSubmit={submit}
          {...drop.handlers}
          onPaste={(e) => {
            const pasted = pastedFiles(e)
            if (pasted.length) files.add(pasted)
          }}
          className={cn(
            "relative flex items-center gap-2 rounded-full border bg-card p-1.5 pl-2 focus-within:ring-2 focus-within:ring-ring/30",
            floating ? "shadow-lg" : "shadow-sm"
          )}
        >
          <DropOverlay show={drop.over} />
          <BotAvatar bot={lead} className="size-7 rounded-full text-sm" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === Mode.Goal
                ? "Give the team a goal. Paste screenshots or drop specs…"
                : `Message ${lead.name}…`
            }
            className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <AttachButton onFiles={files.add} className="shrink-0 rounded-full text-muted-foreground" />
          <div className="flex shrink-0 items-center rounded-full bg-muted p-0.5" role="group" aria-label="Send as">
            {modeButton(Mode.Goal, "Goal", RocketIcon)}
            {modeButton(Mode.Chat, "Chat", MessageSquareIcon)}
          </div>
          <Button
            type="submit"
            size="icon-sm"
            className="rounded-full"
            disabled={!canSend}
            title={files.uploading ? "Wait for uploads to finish" : mode === Mode.Goal ? "Start goal" : `Send to ${lead.name}`}
          >
            <ArrowUpIcon />
          </Button>
        </form>
      </div>
    </div>
  )
}
