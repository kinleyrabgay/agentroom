"use client"

import { AgentEventType } from "@shared"
import { useBotEvents } from "@/hooks/use-bot-events"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ToolRow, type ToolCallEvent, type ToolResultEvent } from "./tool-row"

/** Full timeline of a bot's tool calls with inputs, diffs and outputs. */
export function Activity({ botId }: { botId: string }) {
  const evs = useBotEvents(botId)
  const ref = useStickToBottom(evs.length)
  const calls = evs.filter((e): e is ToolCallEvent => e.type === AgentEventType.ToolCall)
  const results = new Map<string, ToolResultEvent>()
  for (const e of evs) if (e.type === AgentEventType.ToolResult) results.set(e.toolUseId, e)

  return (
    <div ref={ref} className="h-full overflow-y-auto p-3">
      {!calls.length ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>No tool calls yet</EmptyTitle>
            <EmptyDescription>Every file read, edit, command and browser action shows up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="relative space-y-1 border-l pl-4">
          {calls.map((c) => (
            <ToolRow key={c.seq} call={c} result={results.get(c.toolUseId)} />
          ))}
        </ol>
      )}
    </div>
  )
}
