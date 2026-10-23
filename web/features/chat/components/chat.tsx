"use client"

import { useMemo } from "react"
import type { Bot } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { useBotEvents } from "@/hooks/use-bot-events"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { buildTranscript, startsAssistantBlock } from "../lib/transcript"
import { ChatRow } from "./chat-row"
import { Composer } from "./composer"
import { PendingActions, usePendingActions } from "./pending-actions"
import { ThinkingIndicator } from "./thinking-indicator"
import { ApprovalBar } from "./approval-bar"
import { QueuePanel } from "./queue-panel"
import { FindContext, ThreadFindBar, useThreadFind } from "./thread-find"

export function Chat({ bot, running }: { bot: Bot; running: boolean }) {
  const evs = useBotEvents(bot.id)
  const live = useAppStore((s) => s.live[bot.id])
  const bots = useAppStore((s) => s.bots)
  const items = useMemo(
    () => buildTranscript(evs, live, running),
    [evs, live, running]
  )
  const pending = usePendingActions(bot)
  const waiting =
    pending.approvals.length + pending.questions.length + pending.goals.length
  const ref = useStickToBottom(
    `${evs.length}:${live?.text.length ?? 0}:${live?.tools.length ?? 0}:${waiting}`,
    bot.id
  )
  const nameOf = (id: string) =>
    id === "human" ? "You" : (bots.find((b) => b.id === id)?.name ?? id)
  const find = useThreadFind(ref)
  const showThinking =
    running &&
    !live?.text &&
    items.at(-1)?.kind !== "tools" &&
    items.at(-1)?.kind !== "activity"

  return (
    <FindContext.Provider value={find.open && !!find.query}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ThreadFindBar find={find} />
        <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {/* One stable wrapper: the scroll hook watches its size to follow late layout. */}
          <div className="flex min-h-full flex-col">
            {!items.length && !waiting ? (
              <Empty className="flex-1">
                <EmptyHeader>
                  <BotAvatar
                    bot={bot}
                    className="mb-2 size-12 rounded-2xl text-2xl"
                  />
                  <EmptyTitle>Talk to {bot.name}</EmptyTitle>
                  <EmptyDescription>
                    Messages run in this repo with {bot.name}&apos;s tools and
                    skills. Risky actions wait for your approval.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="space-y-4">
                {items.map((it, i) => (
                  <ChatRow
                    key={it.key}
                    item={it}
                    bot={bot}
                    nameOf={nameOf}
                    showAvatar={startsAssistantBlock(items, i)}
                  />
                ))}
                {showThinking && !waiting && (
                  <ThinkingIndicator
                    bot={bot}
                    label={live?.thinking ? "Thinking" : "Working"}
                  />
                )}
                <PendingActions pending={pending} />
              </div>
            )}
          </div>
        </div>
      </div>
      <ApprovalBar approvals={pending.approvals} />
      <QueuePanel bot={bot} />
      <Composer bot={bot} running={running} />
    </FindContext.Provider>
  )
}
