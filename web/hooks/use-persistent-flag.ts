"use client"

import { useCallback, useState } from "react"

function read(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? fallback : stored === "1"
  } catch {
    return fallback
  }
}

/**
 * A boolean kept in localStorage (per browser). Falls back to `initial` when storage is unavailable.
 * Only use under client-only trees (the app renders after TokenGate mounts).
 */
export function usePersistentFlag(
  key: string,
  initial: boolean
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => read(key, initial))

  const update = useCallback(
    (v: boolean) => {
      setValue(v)
      try {
        localStorage.setItem(key, v ? "1" : "0")
      } catch {}
    },
    [key]
  )

  return [value, update]
}
