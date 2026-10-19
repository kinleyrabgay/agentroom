"use client"

import { useEffect } from "react"
import { useReactFlow } from "@xyflow/react"
import { useAppStore } from "@/lib/store/app-store"
import { useSidebar } from "@/components/ui/sidebar"
import { CHROME_SELECTORS, chromeInsets, toPadding } from "../lib/visible-area"

const BASE = { maxZoom: 1, duration: 200 } as const
const INSET_FIT = { padding: 0.25, ...BASE } as const

/**
 * Re-fit the team when the canvas resizes or the bot count changes.
 * `fullBleed`: the canvas fills the window under floating chrome, so fit the team into the area
 * the sidebar, top bar, bot panel and command bar leave visible.
 */
export function AutoFit({
  container,
  count,
  fullBleed = false,
}: {
  container: React.RefObject<HTMLDivElement | null>
  count: number
  fullBleed?: boolean
}) {
  const { fitView } = useReactFlow()
  const selected = useAppStore((s) => s.selectedBot)
  const { state: sidebarState } = useSidebar()

  useEffect(() => {
    const fit = () => fitView(fullBleed ? { padding: toPadding(chromeInsets()), ...BASE } : INSET_FIT)
    let t: ReturnType<typeof setTimeout>
    const later = () => {
      clearTimeout(t)
      // Let panel/sidebar transitions settle before measuring.
      t = setTimeout(fit, 220)
    }
    const ro = new ResizeObserver(later)
    if (container.current) ro.observe(container.current)
    if (fullBleed) {
      for (const sel of [CHROME_SELECTORS.SIDEBAR, CHROME_SELECTORS.BOT_PANEL]) {
        const el = document.querySelector(sel)
        if (el) ro.observe(el)
      }
    }
    later()
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [container, fitView, fullBleed, count, selected, sidebarState])

  return null
}
