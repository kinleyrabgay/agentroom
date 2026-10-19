"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { AlertCapabilities, AlertPrefs } from "@shared"
import { alertApi } from "@/lib/api/endpoints"

export interface AlertPrefsState {
  prefs: AlertPrefs | null
  capabilities: AlertCapabilities | null
  /** Optimistic update; reverted with a toast if the server refuses. */
  update: (patch: Partial<AlertPrefs>) => Promise<void>
  test: () => void
}

/** Personal alert preferences (OS notification, sound, voice). Loads when `enabled` first becomes true. */
export function useAlertPrefs(enabled = true): AlertPrefsState {
  const [data, setData] = useState<{ prefs: AlertPrefs; capabilities: AlertCapabilities } | null>(null)

  useEffect(() => {
    if (!enabled || data) return
    let cancelled = false
    alertApi
      .get()
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => toast.error(e.message))
    return () => {
      cancelled = true
    }
  }, [enabled, data])

  const update = useCallback(
    async (patch: Partial<AlertPrefs>) => {
      if (!data) return
      const previous = data
      setData({ ...data, prefs: { ...data.prefs, ...patch } })
      try {
        await alertApi.update(patch)
      } catch (e) {
        setData(previous)
        toast.error((e as Error).message)
      }
    },
    [data]
  )

  const test = useCallback(() => {
    alertApi.test().catch((e: Error) => toast.error(e.message))
  }, [])

  return { prefs: data?.prefs ?? null, capabilities: data?.capabilities ?? null, update, test }
}
