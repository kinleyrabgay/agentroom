"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ClientMessageType, type PreviewState } from "@shared"
import { send } from "@/lib/realtime/socket"
import { setBridgeDispatcher } from "@/lib/realtime/bridge-dispatch"
import { useAppStore } from "@/lib/store/app-store"
import { addAttachment } from "@/lib/store/attachments"
import { BRIDGE_TAG, FromPage, IFRAME_SANDBOX, PARKED_STYLE, PICKED_LIMITS, SLOT_POLL_MS, ToPage } from "../constants"
import { postToPreview, previewRegistry } from "../lib/preview-registry"

/**
 * Renders every bot's preview iframe outside the normal tree, so pages keep running (and stay
 * controllable by their bot) while their view is closed. Relays bridge messages to the server.
 */
export function PreviewHost() {
  const previews = useAppStore((s) => s.previews)

  useEffect(() => {
    setBridgeDispatcher((botId, id, cmd, actor) => {
      if (!postToPreview(botId, { type: ToPage.Cmd, id, cmd, actor })) {
        send({ type: ClientMessageType.BridgeResult, id, ok: false, error: "The preview is not loaded in the AgentRoom UI." })
      }
    })
    const onFocus = () => send({ type: ClientMessageType.Focus })
    window.addEventListener("focus", onFocus)
    window.addEventListener("message", onBridgeMessage)
    return () => {
      setBridgeDispatcher(null)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("message", onBridgeMessage)
    }
  }, [])

  return (
    <>
      {Object.entries(previews).map(([botId, state]) => (
        <PreviewFrame key={`${botId}:${state.nav}`} botId={botId} state={state} />
      ))}
    </>
  )
}

/** Messages come from the page's own origin: treat everything in them as untrusted data. */
function onBridgeMessage(e: MessageEvent) {
  const d = e.data
  if (!d || d[BRIDGE_TAG] !== true) return
  const botId = previewRegistry.botForWindow(e.source)
  if (!botId) return

  switch (d.type) {
    case FromPage.Ready:
      send({ type: ClientMessageType.BridgeReady, botId, path: String(d.path ?? "/"), title: String(d.title ?? "") })
      break
    case FromPage.Console:
      if (d.line) send({ type: ClientMessageType.BridgeConsole, botId, line: d.line })
      break
    case FromPage.Result:
      send({ type: ClientMessageType.BridgeResult, id: String(d.id), ok: !!d.ok, result: d.result, error: d.error })
      break
    case FromPage.PickState:
      useAppStore.setState((s) => ({ picking: { ...s.picking, [botId]: !!d.on } }))
      break
    case FromPage.Picked:
      if (d.element) onPicked(botId, d.element)
      break
  }
}

function onPicked(botId: string, el: Record<string, unknown>) {
  const pv = useAppStore.getState().previews[botId]
  // The page sees the proxy's origin; show the real site's URL instead.
  const url = pv ? String(el.url).replace(pv.proxy, pv.target) : String(el.url)
  addAttachment(botId, {
    url: url.slice(0, PICKED_LIMITS.url),
    selector: String(el.selector).slice(0, PICKED_LIMITS.selector),
    label: String(el.label).slice(0, PICKED_LIMITS.label),
    text: String(el.text ?? "").slice(0, PICKED_LIMITS.text),
    html: String(el.html ?? "").slice(0, PICKED_LIMITS.html),
  })
  const bot = useAppStore.getState().bots.find((b) => b.id === botId)
  toast.success(`Element added to ${bot?.name ?? botId}'s chat`, { description: String(el.label).slice(0, 80) })
}

function PreviewFrame({ botId, state }: { botId: string; state: PreviewState }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>(PARKED_STYLE)
  // The src is fixed at mount; later path changes come from the page itself, and a
  // server-requested navigation bumps `nav`, which remounts this frame.
  const [src] = useState(() => state.proxy + state.path)

  useEffect(() => {
    const frame = ref.current!
    previewRegistry.setFrame(botId, frame)
    return () => previewRegistry.removeFrame(botId, frame)
  }, [botId])

  useEffect(() => {
    let raf = 0
    let observed: HTMLElement | undefined
    const ro = new ResizeObserver(() => place())
    function place() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const slot = previewRegistry.activeSlot(botId)
        if (slot !== observed) {
          if (observed) ro.unobserve(observed)
          if (slot) ro.observe(slot)
          observed = slot
        }
        if (!slot) return setStyle(PARKED_STYLE)
        const r = slot.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) return setStyle(PARKED_STYLE)
        setStyle({ left: r.left, top: r.top, width: r.width, height: r.height, visibility: "visible" })
      })
    }
    const unsubscribe = previewRegistry.onSlotsChange(place)
    window.addEventListener("resize", place)
    // Panels sometimes move without resizing the slot's own box (e.g. sidebar slide); poll lightly.
    const poll = setInterval(place, SLOT_POLL_MS)
    place()
    return () => {
      unsubscribe()
      window.removeEventListener("resize", place)
      clearInterval(poll)
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [botId])

  return (
    <iframe
      ref={ref}
      src={src}
      title={`${botId} preview`}
      sandbox={IFRAME_SANDBOX}
      className="fixed z-20 rounded-b-xl border-0 bg-white"
      style={style}
    />
  )
}
