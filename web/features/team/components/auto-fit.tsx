"use client"

import { useEffect } from "react"
import { useReactFlow } from "@xyflow/react"

const FIT = { padding: 0.25, maxZoom: 1, duration: 200 } as const

/** Re-fit the team when the canvas resizes (panel opened, sidebar collapsed) or the bot count changes. */
export function AutoFit({ container, count }: { container: React.RefObject<HTMLDivElement | null>; count: number }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    const el = container.current
    if (!el) return
    let t: ReturnType<typeof setTimeout>
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => fitView(FIT), 60)
    })
    ro.observe(el)
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [container, fitView])

  useEffect(() => {
    fitView(FIT)
  }, [count, fitView])

  return null
}
