import { AgentEventType, BotStatus, StreamDeltaType, type StampedEvent, type StreamDelta } from "@shared"

/** What a bot is generating right now (from stream deltas). Cleared as the final events land. */
export interface LiveReply {
  text: string
  thinking: boolean
  tools: { id: string; name: string }[]
}

export const EMPTY_LIVE: LiveReply = { text: "", thinking: false, tools: [] }

export function applyDelta(l: LiveReply, d: StreamDelta): LiveReply {
  switch (d.type) {
    case StreamDeltaType.TextStart:
      return { ...l, text: "", thinking: false }
    case StreamDeltaType.Text:
      return { ...l, text: l.text + d.text, thinking: false }
    case StreamDeltaType.Thinking:
      return { ...l, thinking: true }
    case StreamDeltaType.ToolStart:
      return { ...l, thinking: false, tools: [...l.tools, { id: d.toolUseId, name: d.name }] }
  }
}

/** Final events replace their live counterparts. Returns null when nothing changed. */
export function settleLive(live: Record<string, LiveReply>, ev: StampedEvent): Record<string, LiveReply> | null {
  if (!("botId" in ev) || !ev.botId || !live[ev.botId]) return null
  const cur = live[ev.botId]
  switch (ev.type) {
    case AgentEventType.Message:
      return { ...live, [ev.botId]: { ...cur, text: "" } }
    case AgentEventType.ToolCall:
      return { ...live, [ev.botId]: { ...cur, tools: cur.tools.filter((t) => t.id !== ev.toolUseId) } }
    case AgentEventType.RunDone:
    case AgentEventType.Error:
      return omit(live, ev.botId)
    case AgentEventType.BotStatus:
      return ev.status === BotStatus.Idle || ev.status === BotStatus.Error ? omit(live, ev.botId) : null
    default:
      return null
  }
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key))
}
