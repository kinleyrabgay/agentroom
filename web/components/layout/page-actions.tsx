"use client"

import { useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

/** Id of the top-bar slot pages render their actions into. */
export const PAGE_ACTIONS_ID = "page-actions"

/** Re-check once after mount: the slot is in the DOM by the next frame. */
const subscribe = (onChange: () => void) => {
  const id = requestAnimationFrame(onChange)
  return () => cancelAnimationFrame(id)
}

/**
 * A page's own actions (Refresh, Add server, Export…), shown in the top bar next to the title,
 * so every page has the same header without each one drawing its own.
 */
export function PageActions({ children }: { children: React.ReactNode }) {
  const target = useSyncExternalStore(
    subscribe,
    () => document.getElementById(PAGE_ACTIONS_ID),
    () => null
  )
  return target ? createPortal(children, target) : null
}
