"use client"

import { useState } from "react"
import { ArrowUpIcon, CalendarClockIcon, MessageSquareIcon, RocketIcon } from "lucide-react"
import { toast } from "sonner"
import { ClientMessageType } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab } from "@/lib/constants"
import { automationApi, goalApi } from "@/lib/api/endpoints"
import { View } from "@/lib/constants"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Segmented } from "@/components/kit/segmented"
import { useAttachments } from "@/features/attachments/hooks/use-attachments"
import { pastedFiles, useFileDrop } from "@/features/attachments/hooks/use-file-drop"
import { AttachButton } from "@/features/attachments/components/attach-button"
import { AttachmentTray } from "@/features/attachments/components/attachment-tray"
import { DropOverlay } from "@/features/attachments/components/drop-overlay"
import { ScheduleChip } from "@/features/automation/components/schedule-chip"
import { useTimePhrase } from "@/features/automation/lib/use-time-phrase"
import { formatAt } from "@/features/automation/lib/format"

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
  const time = useTimePhrase(text)
  if (!lead) return null

  const hasContent = !!text.trim() || files.readyIds.length > 0
  const canSend = hasContent && !busy && !files.uploading

  /** "…tomorrow at 9": schedule it instead of running now. */
  const schedule = async () => {
    if (!time.when) return
    if (files.readyIds.length) return toast.error("Attachments can't be kept for later yet. Remove them or send now.")
    const what = time.rest.trim()
    if (!what) return toast.error("Say what to do, as well as when.")
    setBusy(true)
    try {
      await automationApi.createSchedule({
        name: what.slice(0, 80),
        when: time.when,
        action: mode === Mode.Goal ? { type: "goal", brief: what } : { type: "message", botId: lead.id, text: what },
      })
      setText("")
      toast.success(time.when.type === "once" ? `Scheduled for ${formatAt(time.when.at)}` : `Scheduled: ${time.when.label}`, {
        action: { label: "View", onClick: () => useAppStore.getState().setView(View.Automation) },
      })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    if (time.active) return schedule()
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
      toast.error("Describe the goal. Attachments alone aren't enough to plan from.")
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

  return (
    <div className={cn(floating ? "pointer-events-none px-4 pb-4" : "border-t bg-background px-6 py-3")}>
      <div className="pointer-events-auto mx-auto max-w-3xl">
        {time.active && time.when && (
          <div className={cn("mb-2 flex flex-wrap items-center gap-2 rounded-2xl border bg-surface px-3 py-2 text-xs", floating && "shadow-md")}>
            <span className="text-muted-foreground">
              {time.phrase ? <>Found <span className="rounded bg-brand/15 px-1 text-foreground">{time.phrase}</span>:</> : "Runs"}
            </span>
            <ScheduleChip when={time.when} onChange={time.setWhen} />
            <button type="button" onClick={time.dismiss} className="ml-auto rounded-full px-2 py-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
              Send now instead
            </button>
          </div>
        )}
        {files.drafts.length > 0 && (
          <div className={cn("mb-2 rounded-2xl border bg-surface p-2", floating && "shadow-md")}>
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
            "relative flex items-center gap-2 rounded-2xl border bg-surface p-1.5 pl-2 transition-shadow focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-ring/25",
            floating && "shadow-lg"
          )}
        >
          <DropOverlay show={drop.over} />
          <BotAvatar bot={lead} className="size-7 rounded-lg text-sm" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === Mode.Goal
                ? "Give the team a goal. Paste screenshots or drop specs…"
                : `Message ${lead.name}…`
            }
            aria-label={mode === Mode.Goal ? "Goal for the team" : `Message to ${lead.name}`}
            className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <AttachButton onFiles={files.add} className="shrink-0 rounded-lg text-muted-foreground" />
          <Segmented<Mode>
            size="sm"
            aria-label="Send as"
            className="shrink-0"
            value={mode}
            onChange={setMode}
            options={[
              { value: Mode.Goal, label: <><RocketIcon className="size-3.5" /> Goal</>, title: "Start a planned goal" },
              { value: Mode.Chat, label: <><MessageSquareIcon className="size-3.5" /> Chat</>, title: `Message ${lead.name}` },
            ]}
          />
          <Button
            type="submit"
            size={time.active ? "sm" : "icon-sm"}
            className="rounded-xl"
            disabled={!canSend}
            aria-label={files.uploading ? "Wait for uploads to finish" : time.active ? "Schedule" : mode === Mode.Goal ? "Start goal" : `Send to ${lead.name}`}
          >
            {time.active ? (
              <>
                <CalendarClockIcon data-icon="inline-start" /> Schedule
              </>
            ) : (
              <ArrowUpIcon />
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
