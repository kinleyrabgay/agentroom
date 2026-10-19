"use client"

import { useLayoutEffect, useMemo, useRef } from "react"
import { AgentEventType } from "@shared"
import { useBotEvents } from "@/hooks/use-bot-events"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { ToolRow, type ToolCallEvent, type ToolResultEvent } from "./tool-row"

/**
 * Full timeline of a bot's tool calls with inputs, diffs and outputs, newest first.
 * New calls appear at the top; if you've scrolled down to read, the browser's scroll
 * anchoring keeps your place.
 */
export function Activity({ botId }: { botId: string }) {
  const evs = useBotEvents(botId)
  const ref = useRef<HTMLDivElement>(null)
  const { calls, results } = useMemo(() => {
    const results = new Map<string, ToolResultEvent>()
    const calls: ToolCallEvent[] = []
    for (const e of evs) {
      if (e.type === AgentEventType.ToolCall) calls.push(e)
      else if (e.type === AgentEventType.ToolResult) results.set(e.toolUseId, e)
    }
    return { calls: calls.reverse(), results }
  }, [evs])

  // Switching bots starts at the latest call.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0
  }, [botId])

  return (
    <div ref={ref} className="h-full overflow-y-auto p-4">
      {!calls.length ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>No tool calls yet</EmptyTitle>
            <EmptyDescription>
              Every file read, edit, command and browser action shows up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="mb-2 pl-4 text-xs text-muted-foreground">
            {calls.length} {calls.length === 1 ? "call" : "calls"} · newest first
          </p>
          <ol className="relative space-y-1 border-l pl-4">
            {calls.map((c) => (
              <ToolRow key={c.seq} call={c} result={results.get(c.toolUseId)} />
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
