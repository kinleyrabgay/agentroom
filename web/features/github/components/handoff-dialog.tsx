"use client"

import { useMemo, useState } from "react"
import { ArrowRightIcon, FileTextIcon, LinkIcon, Loader2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { Bot } from "@shared"
import { BotTab, View } from "@/lib/constants"
import { filesApi, githubApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { fuzzyScore, MentionTextarea, type MentionTrigger } from "@/components/shared/mention-textarea"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { clearSelection, setGithub, useGithubStore } from "../lib/github-store"
import { itemRef } from "../lib/board-view"
import { fileTokens, isUrl, noteText, removeFileToken, targetBot } from "../lib/handoff"
import { ItemTypeIcon } from "./item-type-icon"

/** Lead first, then everyone else in team order. */
function orderedBots(bots: Bot[]): Bot[] {
  return [...bots].sort((a, b) => Number(!!a.reportsTo) - Number(!!b.reportsTo) || a.order - b.order)
}

/** Give the selected cards to a bot: `/bot` picks who, `@file` adds context, plus links and notes. */
export function HandoffDialog() {
  const open = useGithubStore((s) => s.handoffOpen)
  const selected = useGithubStore((s) => s.selected)
  const items = useGithubStore((s) => s.board?.items ?? [])
  const bots = useAppStore((s) => s.bots)
  const [text, setText] = useState("")
  const [links, setLinks] = useState<string[]>([])
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState(false)

  const cards = items.filter((i) => selected.includes(i.id))
  const team = useMemo(() => orderedBots(bots), [bots])
  const lead = team.find((b) => !b.reportsTo) ?? team[0]
  const target = targetBot(text, bots) ?? lead
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

  const close = (reset: boolean) => {
    setGithub({ handoffOpen: false })
    if (reset) {
      setText("")
      setLinks([])
      setLink("")
    }
  }

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
        note: noteText(text, targetBot(text, bots)) || undefined,
        files: files.length ? files : undefined,
        links: pending.length ? pending : undefined,
      })
      const app = useAppStore.getState()
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
              app.setView(View.Team)
              app.select(res.botId, BotTab.Chat)
            },
          },
        })
      }
      clearSelection()
      close(true)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Hand off {cards.length === 1 ? "card" : `${cards.length} cards`}</DialogTitle>
          <DialogDescription>
            Team Lead starts a goal: plan → your review → build → test → report. Other bots get it as a direct message.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {cards.map((c) => (
            <span key={c.id} className="flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
              <ItemTypeIcon item={c} />
              <span className="font-mono text-muted-foreground">{itemRef(c)}</span>
              <span className="max-w-64 truncate">{c.title}</span>
              <button
                aria-label={`Remove ${itemRef(c)}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setGithub({ selected: selected.filter((id) => id !== c.id) })}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">To</span>
            {target && (
              <span className="flex items-center gap-1.5 rounded-full border px-2 py-0.5">
                <BotAvatar bot={target} className="size-5 rounded-md text-[10px]" />
                {target.name}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              type <kbd className="font-mono">/</kbd> to pick another bot, <kbd className="font-mono">@</kbd> to attach a file
            </span>
          </div>
          <MentionTextarea
            value={text}
            onChange={setText}
            triggers={triggers}
            rows={4}
            autoFocus
            placeholder={`/${lead?.id ?? "team-lead"} take over these cards. Notes, constraints, anything the team should know…`}
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
          <Label htmlFor="handoff-link" className="text-xs">Links (PRs, docs, designs)</Label>
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
            <Button type="button" size="sm" variant="outline" onClick={addLink} disabled={!link.trim()}>Add</Button>
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

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button onClick={send} disabled={!cards.length || !target || busy}>
            {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            Hand to {target?.name ?? "bot"} <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
