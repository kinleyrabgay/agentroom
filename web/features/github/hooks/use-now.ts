"use client"

import { useEffect, useState } from "react"

/** Current time, re-rendered every `ms` (for "updated 12s ago" labels). */
export function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
