import type { PickedElement } from "@shared"
import { useAppStore } from "./app-store"

export function addAttachment(botId: string, el: PickedElement) {
  useAppStore.setState((s) => ({ attachments: { ...s.attachments, [botId]: [...(s.attachments[botId] ?? []), el] } }))
}

export function removeAttachment(botId: string, index: number) {
  useAppStore.setState((s) => ({
    attachments: { ...s.attachments, [botId]: (s.attachments[botId] ?? []).filter((_, i) => i !== index) },
  }))
}

/** Format picked elements as context for the next message, and clear them. */
export function takeAttachments(botId: string): string {
  const list = useAppStore.getState().attachments[botId] ?? []
  if (!list.length) return ""
  useAppStore.setState((s) => ({ attachments: { ...s.attachments, [botId]: [] } }))
  return list.map(formatAttachment).join("")
}

function formatAttachment(el: PickedElement, i: number): string {
  return (
    `\n\n[Selected element ${i + 1} on ${el.url}]\nselector: ${el.selector}\nelement: ${el.label}\n` +
    (el.text ? `text: ${el.text}\n` : "") +
    "html:\n```html\n" +
    el.html +
    "\n```"
  )
}
