"use client"

import { useMemo, useState } from "react"
import { ArrowRightIcon, FileTextIcon, LinkIcon, Loader2Icon, SparklesIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { Bot, GithubItem } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab, View } from "@/lib/constants"
import { filesApi, githubApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { fuzzyScore, MentionTextarea, type MentionTrigger } from "@/components/shared/mention-textarea"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fileTokens, isUrl, noteText, removeFileToken, targetBot } from "../lib/handoff"

/** Lead first, then everyone else in team order. */
export function orderedBots(bots: Bot[]): Bot[] {
  return [...bots].sort((a, b) => Number(!!a.reportsTo) - Number(!!b.reportsTo) || a.order - b.order)
}

const GOAL_STEPS = ["Plan", "Your review", "Build", "Security", "Test", "Report"]

/**
 * Who takes the card(s), what they should know (note, `@files`, links), and what happens next.
 * Used inline at the bottom of a card's details and inside the multi-card hand-off dialog.
 */
export function HandoffForm({
  cards,
  onDone,
  autoFocus = false,
  className,
}: {
  cards: GithubItem[]
  onDone?: () => void
  autoFocus?: boolean
  className?: string
}) {
  const bots = useAppStore((s) => s.bots)
  const team = useMemo(() => orderedBots(bots), [bots])
  const lead = team.find((b) => !b.reportsTo) ?? team[0]
  const [picked, setPicked] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [links, setLinks] = useState<string[]>([])
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState(false)

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

  const send = async () => {
    if (!cards.length || !target || busy) return
    setBusy(true)
    try {
      const pending = link.trim() && isUrl(link) ? [...links, link.trim()] : links
      const res = await githubApi.handoff({
        itemIds: cards.map((c) => c.id),
        botId: target.id,
        note: noteText(text, typed) || undefined,
        files: files.length ? files : undefined,
        links: pending.length ? pending : undefined,
      })
      if (res.goal) {
        const goal = res.goal
        toast.success(`Handed to ${target.name} · ${goal.id} started`, {
          description: "The Planner is breaking it into tasks for your review.",
          action: { label: "Open in Tasks", onClick: () => useAppStore.getState().showOnTasks({ goalId: goal.id }) },
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

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Who takes it</Label>
        <div className="flex flex-wrap gap-1.5">
          {team.map((b) => {
            const active = target?.id === b.id
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setPicked(b.id)
                  if (typed && typed.id !== b.id) setText(noteText(text, typed))
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-xs transition-colors",
                  active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <BotAvatar bot={b} className="size-5 rounded-full text-[10px]" />
                {b.name}
                {!b.reportsTo && <span className="text-[10px] opacity-70">· starts a goal</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
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
              <span key={f} className="flex items-center gap-1 rounded-lg border bg-background px-2 py-0.5 font-mono text-[11px]">
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
        <Label htmlFor="handoff-link" className="text-xs text-muted-foreground">Links (PRs, docs, designs)</Label>
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
              <span key={l} className="flex max-w-full items-center gap-1 rounded-lg border bg-background px-2 py-0.5 text-[11px]">
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

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {startsGoal ? (
            <div className="flex flex-wrap items-center gap-1">
              <SparklesIcon className="size-3.5" />
              Starts a goal:
              {GOAL_STEPS.map((s, i) => (
                <span key={s} className="flex items-center gap-1">
                  <span className={cn(s === "Your review" && "font-medium text-foreground")}>{s}</span>
                  {i < GOAL_STEPS.length - 1 && <ArrowRightIcon className="size-3 opacity-50" />}
                </span>
              ))}
            </div>
          ) : (
            <span>Sent to {target?.name} as a direct message with the card details.</span>
          )}
        </div>
        <Button onClick={send} disabled={!cards.length || !target || busy}>
          {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
          Hand to {target?.name ?? "bot"} <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
