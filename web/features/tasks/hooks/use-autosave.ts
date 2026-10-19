"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AUTOSAVE_DELAY_MS } from "../constants"

export const SaveState = {
  Idle: "idle",
  Saving: "saving",
  Saved: "saved",
  Error: "error",
} as const
export type SaveState = (typeof SaveState)[keyof typeof SaveState]

/**
 * Debounced, merging autosave. `queue(patch)` merges into a pending patch and saves it after
 * a quiet period; `flush()` saves immediately (e.g. on close). Patches are applied in order.
 */
export function useAutosave<P extends object>(
  save: (patch: P) => Promise<unknown>,
  delay = AUTOSAVE_DELAY_MS
) {
  const [state, setState] = useState<SaveState>(SaveState.Idle)
  const pending = useRef<Partial<P> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const patch = pending.current
    if (!patch) return
    pending.current = null
    setState(SaveState.Saving)
    try {
      await saveRef.current(patch as P)
      setState(pending.current ? SaveState.Saving : SaveState.Saved)
    } catch (e) {
      setState(SaveState.Error)
      toast.error((e as Error).message)
    }
  }, [])

  const queue = useCallback(
    (patch: Partial<P>) => {
      pending.current = { ...(pending.current ?? {}), ...patch }
      setState(SaveState.Saving)
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [delay, flush]
  )

  // Save whatever is pending when the editor unmounts.
  useEffect(() => () => void flush(), [flush])

  return { state, queue, flush }
}
