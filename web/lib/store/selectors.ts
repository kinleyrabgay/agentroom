import { AgentEventType, type EventOf, type PreviewState, type StampedEvent, type Stamped } from "@shared"

export type PermissionRequest = Stamped<EventOf<typeof AgentEventType.PermissionRequest>>

/** Permission requests the human hasn't answered yet. */
export function pendingApprovals(events: StampedEvent[]): PermissionRequest[] {
  const resolved = new Set<string>()
  for (const e of events) if (e.type === AgentEventType.PermissionResolved) resolved.add(e.requestId)
  return events.filter((e): e is PermissionRequest => e.type === AgentEventType.PermissionRequest && !resolved.has(e.requestId))
}

export function botEvents(events: StampedEvent[], botId: string) {
  return events.filter((e) => "botId" in e && e.botId === botId)
}

/** The real site's URL for a preview (the iframe itself loads the proxy). */
export function previewUrl(p: PreviewState) {
  return p.target + p.path
}

export const stripScheme = (url: string) => url.replace(/^https?:\/\//, "")
