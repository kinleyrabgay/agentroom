"use client"

import { useEffect } from "react"
import { GlobeIcon } from "lucide-react"
import { ToolName, type Bot, type PreviewState } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { previewUrl, stripScheme } from "@/lib/store/selectors"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { StatusDot } from "@/components/shared/status-dot"
import { BrowserSurface } from "./browser-surface"

/** Bots with an open page first, then bots that have the Browser tool. */
function rankBots(bots: Bot[], previews: Record<string, PreviewState>) {
  const score = (b: Bot) => (previews[b.id] ? 2 : 0) + (b.tools.includes(ToolName.Browser) ? 1 : 0)
  return [...bots].sort((a, b) => score(b) - score(a))
}

/** Full-size browser view: pick a bot on the left, its page fills the rest. */
export function BrowserWorkspace() {
  const bots = useAppStore((s) => s.bots)
  const previews = useAppStore((s) => s.previews)
  const browserBot = useAppStore((s) => s.browserBot)
  const setBrowserBot = useAppStore((s) => s.setBrowserBot)
  const selectedBot = useAppStore((s) => s.selectedBot)
  const select = useAppStore((s) => s.select)

  const ranked = rankBots(bots, previews)
  const current = bots.find((b) => b.id === browserBot) ?? ranked[0]

  useEffect(() => {
    if (current && current.id !== browserBot) setBrowserBot(current.id)
  }, [current, browserBot, setBrowserBot])

  // The full view and the bot panel's Browser tab would fight over the same page.
  useEffect(() => {
    if (current && selectedBot === current.id && useAppStore.getState().botTab === BotTab.Browser) select(current.id, BotTab.Chat)
  }, [current, selectedBot, select])

  if (!current) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon"><GlobeIcon /></EmptyMedia>
          <EmptyTitle>No bots yet</EmptyTitle>
          <EmptyDescription>Add a bot to give it a browser.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="absolute inset-0 flex">
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-r p-2">
        <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">Browsers</p>
        {ranked.map((b) => {
          const p = previews[b.id]
          return (
            <button
              key={b.id}
              onClick={() => setBrowserBot(b.id)}
              className={cn("flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-muted", current.id === b.id && "bg-muted")}
            >
              <BotAvatar bot={b} className="size-7 rounded-lg text-sm" />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="flex items-center gap-1.5 truncate">
                  {b.name} <StatusDot botId={b.id} />
                </span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {p ? stripScheme(previewUrl(p)) : b.tools.includes(ToolName.Browser) ? "no page open" : "browser off"}
                </span>
              </span>
            </button>
          )
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <BrowserSurface key={current.id} bot={current} />
      </div>
    </div>
  )
}
