"use client"

import { useMemo, useState } from "react"
import { ArrowRightIcon, FileTextIcon, LinkIcon, Loader2Icon, PlusIcon, SparklesIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { Bot, HandoffResult, ScheduleWhen } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab, View } from "@/lib/constants"
import { automationApi, filesApi } from "@/lib/api/endpoints"
import { fileTokens, isUrl, noteText, removeFileToken, targetBot } from "@/lib/handoff"
import { useAppStore } from "@/lib/store/app-store"
import { Segmented } from "@/components/kit/segmented"
import { ScheduleChip } from "@/features/automation/components/schedule-chip"
import { formatAt } from "@/features/automation/lib/format"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { fuzzyScore, MentionTextarea, type MentionTrigger } from "@/components/shared/mention-textarea"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NewBotDialog, type NewBotDefaults } from "@/features/team/components/new-bot-dialog"

/** Lead first, then everyone else in team order. */
export function orderedBots(bots: Bot[]): Bot[] {
  return [...bots].sort((a, b) => Number(!!a.reportsTo) - Number(!!b.reportsTo) || a.order - b.order)
}

const GOAL_STEPS = ["Plan", "Your review", "Build", "Security", "Test", "Report"]

/** What the form collects; the caller adds which cards/issues it is about. */
export interface HandoffPayload {
  botId: string
  note?: string
  files?: string[]
  links?: string[]
}

export interface HandoffFormProps {
  /** Calls the right endpoint (GitHub cards, Sentry issues…). */
  send: (input: HandoffPayload) => Promise<HandoffResult>
  /** How many things are handed off; 0 disables the button. */
  count: number
  /** What a direct message to a non-lead bot contains, e.g. "the card details". */
  directContent?: string
  /** Offer a "+ New bot" chip that creates a bot for this kind of work. */
  newBot?: NewBotDefaults
  onDone?: () => void
  autoFocus?: boolean
  className?: string
  /** Where the work comes from, to offer "Later" (a scheduled hand-off). */
  later?: { source: "github" | "sentry" | "linear" | "jira"; ids: string[]; label: string }
}

/**
 * Who takes the work, what they should know (note, `@files`, links), and what happens next.
 * Used for GitHub cards and Sentry issues, inline in a details panel or in a multi-select dialog.
 */
export function HandoffForm({ send, count, directContent = "the details", newBot, onDone, autoFocus = false, className, later }: HandoffFormProps) {
  const bots = useAppStore((s) => s.bots)
  const team = useMemo(() => orderedBots(bots), [bots])
  const lead = team.find((b) => !b.reportsTo) ?? team[0]
  const [picked, setPicked] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [links, setLinks] = useState<string[]>([])
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState(false)
  const [timing, setTiming] = useState<"now" | "later">("now")
  const [when, setWhen] = useState<ScheduleWhen>(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return { type: "once", at: d.toISOString() }
  })
  const [creating, setCreating] = useState(false)

  // A `/bot` typed in the note wins over the chip, so keyboard users never need the mouse.
  const typed = targetBot(text, bots)
  const target = typed ?? team.find((b) => b.id === picked) ?? lead
  const startsGoal = !!target && !target.reportsTo
  const files = fileTokens(text)

  const triggers = useMemo<Record<string, MentionTrigger>>(
    () => ({
      "/": {
        title: "Hand to a bot",
        suggest: (q) =>
          team
            .map((b) => ({ b, score: fuzzyScore(`${b.id} ${b.name}`, q) }))
            .filter((x) => x.score !== null)
            .map(({ b }) => ({
              id: b.id,
              insert: `/${b.id}`,
              label: `/${b.id}`,
              description: `${b.name} · ${b.role}`,
              icon: <BotAvatar bot={b} className="size-6 rounded-md text-xs" />,
              hint: b.reportsTo ? undefined : "starts a goal",
            })),
      },
      "@": {
        title: "Attach a repo file",
        empty: "No files match",
        suggest: async (q) =>
          (await filesApi.search(q, 20)).map((p) => ({
            id: p,
            insert: `@${p}`,
            label: p,
            icon: <FileTextIcon className="size-4 text-muted-foreground" />,
          })),
      },
    }),
    [team]
  )

  const addLink = () => {
    const v = link.trim()
    if (!v) return
    if (!isUrl(v)) return toast.error("Links must start with http:// or https://")
    if (!links.includes(v)) setLinks([...links, v])
    setLink("")
  }

  const scheduleLater = async () => {
    if (!later || !target) return
    const note = [noteText(text, typed), ...files.map((f) => `@${f}`), ...links].filter(Boolean).join("\n")
    setBusy(true)
    try {
      await automationApi.createSchedule({
        name: `Hand off ${later.label} to ${target.name}`.slice(0, 120),
        when,
        action: { type: "handoff", source: later.source, ids: later.ids, botId: target.id, ...(note ? { note } : {}) },
      })
      toast.success(when.type === "once" ? `Hand-off scheduled for ${formatAt(when.at)}` : `Hand-off scheduled: ${when.label}`)
      setText("")
      setLinks([])
      setLink("")
      onDone?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!count || !target || busy) return
    if (later && timing === "later") return scheduleLater()
    setBusy(true)
    try {
      const pending = link.trim() && isUrl(link) ? [...links, link.trim()] : links
      const res = await send({
        botId: target.id,
        note: noteText(text, typed) || undefined,
        files: files.length ? files : undefined,
        links: pending.length ? pending : undefined,
      })
      if (res.goal) {
        const goal = res.goal
        toast.success(`Handed to ${target.name} · ${goal.id} started`, {
          description: "The Planner is breaking it into tasks for your review.",
          action: { label: "Open in Work", onClick: () => useAppStore.getState().showOnTasks({ goalId: goal.id }) },
        })
      } else {
        toast.success(`Handed to ${target.name}`, {
          action: {
            label: "Open chat",
            onClick: () => {
              const app = useAppStore.getState()
              app.setView(View.Team)
              app.select(res.botId, BotTab.Chat)
            },
          },
        })
      }
      setText("")
      setLinks([])
      setLink("")
      onDone?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const chip = (active: boolean) =>
    cn(
      "flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
      active ? "tone-brand tone-soft font-medium text-foreground" : "bg-surface text-muted-foreground hover:bg-accent hover:text-foreground"
    )

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-2">
        <Label className="text-[13px] text-muted-foreground">Who takes it</Label>
        <div className="flex flex-wrap gap-1.5">
          {team.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setPicked(b.id)
                if (typed && typed.id !== b.id) setText(noteText(text, typed))
              }}
              className={chip(target?.id === b.id)}
            >
              <BotAvatar bot={b} className="size-6 rounded-full text-xs" />
              {b.name}
              {!b.reportsTo && <span className="text-xs opacity-70">· starts a goal</span>}
            </button>
          ))}
          {newBot && (
            <button type="button" onClick={() => setCreating(true)} className={cn(chip(false), "border-dashed pl-2")}>
              <PlusIcon className="size-3.5" /> New bot
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] text-muted-foreground">
          Notes for {target?.name ?? "the team"}
          <span className="ml-1 font-normal">
            (<kbd className="font-mono">@</kbd> attaches a repo file, <kbd className="font-mono">/</kbd> picks a bot)
          </span>
        </Label>
        <MentionTextarea
          value={text}
          onChange={setText}
          triggers={triggers}
          rows={3}
          autoFocus={autoFocus}
          placeholder="Constraints, acceptance notes, where to look… e.g. @docs/dependency-logic.md"
          className="resize-none text-sm"
        />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span key={f} className="flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 font-mono text-xs">
                <FileTextIcon className="size-3 text-muted-foreground" /> {f}
                <button aria-label={`Remove ${f}`} className="text-muted-foreground hover:text-foreground" onClick={() => setText(removeFileToken(text, f))}>
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="handoff-link" className="text-[13px] text-muted-foreground">Links (PRs, docs, designs)</Label>
        <div className="flex gap-2">
          <Input
            id="handoff-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addLink()
              }
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").split(/\s+/).filter(isUrl)
              if (pasted.length > 1) {
                e.preventDefault()
                setLinks([...new Set([...links, ...pasted])])
              }
            }}
            placeholder="https://github.com/acme/app/pull/42"
            className="h-8 font-mono text-xs"
          />
          <Button type="button" size="sm" variant="outline" onClick={addLink} disabled={!link.trim()}>
            Add
          </Button>
        </div>
        {links.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {links.map((l) => (
              <span key={l} className="flex max-w-full items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-xs">
                <LinkIcon className="size-3 text-muted-foreground" />
                <span className="max-w-80 truncate font-mono">{l}</span>
                <button aria-label="Remove link" className="text-muted-foreground hover:text-foreground" onClick={() => setLinks(links.filter((x) => x !== l))}>
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {later && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<"now" | "later">
            size="sm"
            aria-label="When"
            value={timing}
            onChange={setTiming}
            options={[
              { value: "now", label: "Now" },
              { value: "later", label: "Later" },
            ]}
          />
          {timing === "later" && <ScheduleChip when={when} onChange={setWhen} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {startsGoal ? (
            <div className="flex flex-wrap items-center gap-1">
              <SparklesIcon className="size-3.5" />
              Starts a goal:
              {GOAL_STEPS.map((s, i) => (
                <span key={s} className="flex items-center gap-1">
                  <span className={cn(s === "Your review" && "font-medium text-brand-ink")}>{s}</span>
                  {i < GOAL_STEPS.length - 1 && <ArrowRightIcon className="size-3 opacity-50" />}
                </span>
              ))}
            </div>
          ) : (
            <span>
              Sent to {target?.name} as a direct message with {directContent}.
            </span>
          )}
        </div>
        <Button onClick={submit} disabled={!count || !target || busy}>
          {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
          {later && timing === "later" ? "Schedule hand-off" : <>Hand to {target?.name ?? "bot"}</>} <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>

      {newBot && (
        <NewBotDialog
          open={creating}
          onOpenChange={setCreating}
          defaults={newBot}
          onCreated={(bot) => {
            setPicked(bot.id)
            if (typed) setText(noteText(text, typed))
          }}
        />
      )}
    </div>
  )
}
