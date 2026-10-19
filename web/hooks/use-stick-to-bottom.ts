"use client"

import { useEffect, useRef } from "react"

/** Keep a scroll container pinned to the bottom unless the user has scrolled up. */
export function useStickToBottom(dep: unknown, threshold = 240) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < threshold) el.scrollTop = el.scrollHeight
  }, [dep, threshold])
  return ref
}
