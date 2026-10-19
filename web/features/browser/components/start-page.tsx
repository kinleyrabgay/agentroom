"use client"

import { useState } from "react"
import { GlobeIcon, PlayIcon } from "lucide-react"
import { toast } from "sonner"
import { ClientMessageType, ToolName, type Bot } from "@shared"
import { DEV_SERVER_SUGGESTIONS } from "@/lib/constants"
import { botApi } from "@/lib/api/endpoints"
import { send } from "@/lib/realtime/socket"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

/** Shown when the bot doesn't have the Browser tool yet. */
export function EnableBrowser({ bot }: { bot: Bot }) {
  const enable = () =>
    botApi
      .update(bot.id, { tools: [...bot.tools, ToolName.Browser] })
      .then(() => toast.success("Browser enabled"))
      .catch((e) => toast.error((e as Error).message))
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><GlobeIcon /></EmptyMedia>
        <EmptyTitle>Give {bot.name} a browser</EmptyTitle>
        <EmptyDescription>
          A lightweight in-app browser for your dev server. {bot.name} can open pages, read them, click, type and check the console, and you
          watch it happen here.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={enable}>
          <GlobeIcon data-icon="inline-start" /> Enable browser
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/** Shown when the bot has a browser but no page is open. */
export function StartPage({ bot }: { bot: Bot }) {
  const [url, setUrl] = useState("")
  const open = (u: string) => u.trim() && send({ type: ClientMessageType.BrowserOpen, botId: bot.id, url: u.trim() })
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><GlobeIcon /></EmptyMedia>
        <EmptyTitle>Open a page for {bot.name}</EmptyTitle>
        <EmptyDescription>Usually your dev server. {bot.name} opens pages itself when it needs to; the page shows up here.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="w-full max-w-md">
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            open(url)
          }}
        >
          <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEV_SERVER_SUGGESTIONS[0]} className="font-mono" />
          <Button type="submit" disabled={!url.trim()}>
            <PlayIcon data-icon="inline-start" /> Open
          </Button>
        </form>
        <div className="flex flex-wrap justify-center gap-1.5">
          {DEV_SERVER_SUGGESTIONS.map((s) => (
            <Button key={s} variant="outline" size="xs" className="font-mono" onClick={() => open(s)}>
              {s}
            </Button>
          ))}
        </div>
      </EmptyContent>
    </Empty>
  )
}
