"use client"

import { useMemo } from "react"
import type { Bot } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { useBotEvents } from "@/hooks/use-bot-events"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { buildTranscript, startsAssistantBlock } from "../lib/transcript"
import { ChatRow } from "./chat-row"
import { Composer } from "./composer"
import { ThinkingIndicator } from "./thinking-indicator"

export function Chat({ bot, running }: { bot: Bot; running: boolean }) {
  const evs = useBotEvents(bot.id)
  const live = useAppStore((s) => s.live[bot.id])
  const bots = useAppStore((s) => s.bots)
  const items = useMemo(() => buildTranscript(evs, live, running), [evs, live, running])
  const ref = useStickToBottom(`${evs.length}:${live?.text.length ?? 0}:${live?.tools.length ?? 0}`)
  const nameOf = (id: string) => (id === "human" ? "You" : (bots.find((b) => b.id === id)?.name ?? id))
  const showThinking = running && !live?.text && items.at(-1)?.kind !== "tools"

  return (
    <>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!items.length ? (
          <Empty className="h-full">
            <EmptyHeader>
              <BotAvatar bot={bot} className="mb-2 size-12 rounded-2xl text-2xl" />
              <EmptyTitle>Talk to {bot.name}</EmptyTitle>
              <EmptyDescription>
                Messages run in this repo with {bot.name}&apos;s tools and skills. Risky actions wait for your approval.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-4">
            {items.map((it, i) => (
              <ChatRow key={it.key} item={it} bot={bot} nameOf={nameOf} showAvatar={startsAssistantBlock(items, i)} />
            ))}
            {showThinking && <ThinkingIndicator bot={bot} label={live?.thinking ? "Thinking" : "Working"} />}
          </div>
        )}
      </div>
      <Composer bot={bot} />
    </>
  )
}
