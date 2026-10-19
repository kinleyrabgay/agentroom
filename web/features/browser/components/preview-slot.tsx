"use client"

import { useLayoutEffect, useRef } from "react"
import { previewRegistry } from "../lib/preview-registry"

/** Placeholder the bot's (persistent) iframe is laid over while this view is mounted. */
export function PreviewSlot({ botId, className }: { botId: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    previewRegistry.addSlot(botId, el)
    return () => previewRegistry.removeSlot(botId, el)
  }, [botId])
  return <div ref={ref} className={className} />
}
