import { useAppStore } from "@/lib/store/app-store"
import { BRIDGE_TAG } from "../constants"

/**
 * Bookkeeping that links bots to their preview iframes and to the on-screen slots that
 * show them. Module-level so iframes survive view changes.
 */
const slots = new Map<string, HTMLElement[]>()
const frames = new Map<string, HTMLIFrameElement>()
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((fn) => fn())

export const previewRegistry = {
  addSlot(botId: string, el: HTMLElement) {
    slots.set(botId, [...(slots.get(botId) ?? []), el])
    notify()
  },
  removeSlot(botId: string, el: HTMLElement) {
    slots.set(botId, (slots.get(botId) ?? []).filter((x) => x !== el))
    notify()
  },
  /** The most recently mounted slot wins when several views show the same bot. */
  activeSlot: (botId: string) => slots.get(botId)?.at(-1),

  setFrame(botId: string, frame: HTMLIFrameElement) {
    frames.set(botId, frame)
  },
  removeFrame(botId: string, frame: HTMLIFrameElement) {
    if (frames.get(botId) === frame) frames.delete(botId)
  },
  botForWindow: (win: MessageEventSource | null) => [...frames.entries()].find(([, f]) => f.contentWindow === win)?.[0],

  onSlotsChange(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

/** Post a message into a bot's preview page. Returns false if the page isn't loaded. */
export function postToPreview(botId: string, msg: Record<string, unknown>) {
  const frame = frames.get(botId)
  const state = useAppStore.getState().previews[botId]
  if (!frame?.contentWindow || !state) return false
  frame.contentWindow.postMessage({ [BRIDGE_TAG]: true, ...msg }, state.proxy)
  return true
}
