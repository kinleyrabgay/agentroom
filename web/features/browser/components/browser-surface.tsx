"use client"

import { useEffect, useMemo, useState } from "react"
import { HandIcon } from "lucide-react"
import { ClientMessageType, ToolName, type Bot } from "@shared"
import { isBusy } from "@/lib/constants"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { ToneDot } from "@/components/kit/badge"
import { ToPage } from "../constants"
import { postToPreview } from "../lib/preview-registry"
import { BrowserToolbar } from "./browser-toolbar"
import { ConsolePanel, isProblem } from "./console-panel"
import { PreviewSlot } from "./preview-slot"
import { EnableBrowser, StartPage } from "./start-page"

/** A bot's in-app browser: enable → start page → live page with dev tools. */
export function BrowserSurface({ bot, compact = false }: { bot: Bot; compact?: boolean }) {
  const preview = useAppStore((s) => s.previews[bot.id])
  if (!bot.tools.includes(ToolName.Browser)) return <EnableBrowser bot={bot} />
  if (!preview) return <StartPage bot={bot} />
  return <LiveSurface bot={bot} compact={compact} />
}

function LiveSurface({ bot, compact }: { bot: Bot; compact: boolean }) {
  const preview = useAppStore((s) => s.previews[bot.id])!
  const picking = useAppStore((s) => !!s.picking[bot.id])
  const lines = useAppStore((s) => s.consoles[bot.id])
  const status = useAppStore((s) => s.statuses[bot.id]?.status)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [clearedAt, setClearedAt] = useState(0)

  const shown = useMemo(() => (lines ?? []).filter((l) => l.ts > clearedAt), [lines, clearedAt])
  const problems = shown.filter(isProblem).length
  const botBusy = isBusy(status)

  // Esc cancels picking even when focus is outside the page.
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && postToPreview(bot.id, { type: ToPage.Pick, on: false })
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [picking, bot.id])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BrowserToolbar
        bot={bot}
        preview={preview}
        compact={compact}
        picking={picking}
        consoleOpen={consoleOpen}
        problems={problems}
        onToggleConsole={() => setConsoleOpen(!consoleOpen)}
      />

      {preview.humanControl && (
        <div className="tone-warning tone-soft flex items-center gap-2 border-x-0 border-t-0 border-b px-3 py-1.5 text-xs">
          <HandIcon className="size-3.5" /> You have control. {bot.name}&apos;s browser actions wait until you hand it back.
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => send({ type: ClientMessageType.BrowserControl, botId: bot.id, on: false })}>
            Hand back
          </Button>
        </div>
      )}

      <PreviewSlot botId={bot.id} className="min-h-0 flex-1 bg-white" />

      {consoleOpen && <ConsolePanel lines={shown} onClear={() => setClearedAt(Date.now())} />}

      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
        <ToneDot tone={botBusy ? "brand" : "success"} pulse={botBusy} />
        <span className="truncate">{preview.title || preview.target}</span>
        <span className="ml-auto shrink-0">
          {picking
            ? "Click an element on the page · Esc to cancel"
            : botBusy
              ? `${bot.name} is working`
              : "Live preview · you and the bot share this page"}
        </span>
      </div>
    </div>
  )
}
