import type { Notification } from "@shared"

type Listener = (n: Notification) => void
const listeners = new Set<Listener>()

/** Fired once per notification the server creates while the UI is open (not for history in `hello`). */
export function onNotification(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function emitNotification(n: Notification) {
  for (const fn of listeners) fn(n)
}
