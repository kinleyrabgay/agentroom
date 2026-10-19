"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { Settings, SettingsPatch } from "@shared"
import { settingsApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { AUTOSAVE_MS, SAVED_VISIBLE_MS } from "../lib/constants"

export const SaveStatus = { Idle: "idle", Saving: "saving", Saved: "saved" } as const
export type SaveStatus = (typeof SaveStatus)[keyof typeof SaveStatus]

type Section = Exclude<keyof Settings, "version">

/**
 * Edit one settings section with optimistic, debounced autosave.
 * Edits show immediately; after a pause they're PATCHed; on failure the last saved settings come back with a toast.
 */
export function useSettingsSection<K extends Section>(section: K) {
  const value = useAppStore((s) => s.settings?.[section]) as Settings[K] | undefined
  const [status, setStatus] = useState<SaveStatus>(SaveStatus.Idle)
  const pending = useRef<Partial<Settings[K]>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSaved = useRef<Settings | null>(null)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    timer.current = undefined
    const patch = pending.current
    pending.current = {}
    if (!Object.keys(patch).length) return
    try {
      const next = await settingsApi.update({ [section]: patch } as SettingsPatch)
      useAppStore.setState({ settings: next })
      setStatus(SaveStatus.Saved)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setStatus(SaveStatus.Idle), SAVED_VISIBLE_MS)
    } catch (e) {
      if (lastSaved.current) useAppStore.setState({ settings: lastSaved.current })
      setStatus(SaveStatus.Idle)
      toast.error(`Couldn't save: ${(e as Error).message}`)
    } finally {
      lastSaved.current = null
    }
  }, [section])

  const update = useCallback(
    (patch: Partial<Settings[K]>) => {
      const current = useAppStore.getState().settings
      if (!current) return
      lastSaved.current ??= current
      useAppStore.setState({ settings: { ...current, [section]: { ...current[section], ...patch } } })
      pending.current = { ...pending.current, ...patch }
      setStatus(SaveStatus.Saving)
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, AUTOSAVE_MS)
    },
    [section, flush]
  )

  // Don't lose an edit when the page is left before the debounce fires.
  useEffect(
    () => () => {
      clearTimeout(savedTimer.current)
      if (timer.current) void flush()
    },
    [flush]
  )

  return { value, update, status }
}
