"use client"

import { ClientMessageType } from "@shared"
import { send } from "./socket"

let last: boolean | null = null
let started = false

const isActive = () => document.visibilityState === "visible" && document.hasFocus()

/** Tell the server whether the human is looking at this tab (alerts fire only when they're away). */
export function reportPresence(force = false) {
  const active = isActive()
  if (!force && active === last) return
  last = active
  send({ type: ClientMessageType.Presence, active })
}

/** Watch focus/visibility once per page. */
export function startPresence() {
  if (started) return
  started = true
  const update = () => reportPresence()
  document.addEventListener("visibilitychange", update)
  window.addEventListener("focus", update)
  window.addEventListener("blur", update)
}
