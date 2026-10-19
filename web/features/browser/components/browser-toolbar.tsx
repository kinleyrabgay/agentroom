"use client"

import { useState } from "react"
import { ArrowLeftIcon, ArrowRightIcon, CrosshairIcon, GlobeIcon, HandIcon, RotateCwIcon, TerminalSquareIcon, XIcon } from "lucide-react"
import { ClientMessageType, type Bot, type PreviewState } from "@shared"
import { send } from "@/lib/realtime/socket"
import { previewUrl } from "@/lib/store/selectors"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { NavAction, ToPage } from "../constants"
import { postToPreview } from "../lib/preview-registry"

interface Props {
  bot: Bot
  preview: PreviewState
  compact: boolean
  picking: boolean
  consoleOpen: boolean
  problems: number
  onToggleConsole: () => void
}

/** Address bar and dev tools: navigation, element picker, console, take control, close. */
export function BrowserToolbar({ bot, preview, compact, picking, consoleOpen, problems, onToggleConsole }: Props) {
  // While the user is typing, their text wins; otherwise show the page's live URL.
  const [typed, setTyped] = useState<string | null>(null)
  const url = typed ?? previewUrl(preview)
  const control = preview.humanControl


  const nav = (action: NavAction) => postToPreview(bot.id, { type: ToPage.Nav, action })

  return (
    <form
      className="flex items-center gap-0.5 border-b px-2 py-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (url.trim()) send({ type: ClientMessageType.BrowserOpen, botId: bot.id, url: url.trim() })
        setTyped(null)
        ;(document.activeElement as HTMLElement | null)?.blur()
      }}
    >
      <ToolButton label="Back" onClick={() => nav(NavAction.Back)}><ArrowLeftIcon /></ToolButton>
      {!compact && <ToolButton label="Forward" onClick={() => nav(NavAction.Forward)}><ArrowRightIcon /></ToolButton>}
      <ToolButton label="Reload" onClick={() => nav(NavAction.Reload)}><RotateCwIcon /></ToolButton>
      <div className="relative mx-1 flex-1">
        <GlobeIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={url}
          onFocus={(e) => {
            setTyped(url)
            e.target.select()
          }}
          onBlur={() => setTyped(null)}
          onChange={(e) => setTyped(e.target.value)}
          spellCheck={false}
          className="h-8 rounded-full pl-8 font-mono text-xs"
        />
      </div>
      <ToolButton
        label={picking ? "Cancel picking (Esc)" : "Select an element to send to chat"}
        active={picking}
        onClick={() => postToPreview(bot.id, { type: ToPage.Pick, on: !picking })}
      >
        <CrosshairIcon />
      </ToolButton>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant={consoleOpen ? "secondary" : "ghost"} size="sm" className="h-8 gap-1 px-2" onClick={onToggleConsole}>
            <TerminalSquareIcon />
            {problems > 0 && <Badge variant="destructive" className="h-4 px-1 text-[10px]">{problems}</Badge>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Console and network errors</TooltipContent>
      </Tooltip>
      <ToolButton
        label={control ? `Hand control back to ${bot.name}` : `Take control (pauses ${bot.name}'s browser actions)`}
        active={control}
        onClick={() => send({ type: ClientMessageType.BrowserControl, botId: bot.id, on: !control })}
      >
        <HandIcon />
      </ToolButton>
      <ToolButton label="Close page" onClick={() => send({ type: ClientMessageType.BrowserClose, botId: bot.id })}><XIcon /></ToolButton>
    </form>
  )
}

function ToolButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={active ? "secondary" : "ghost"} size="icon-sm" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
