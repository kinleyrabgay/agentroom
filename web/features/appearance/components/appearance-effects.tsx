"use client"

import { useEffect } from "react"
import { applyAppearance, msToNextSwitch } from "../lib/appearance"
import { useAppearance } from "../lib/store"

/** Applies this browser's look, follows other tabs' changes, and moves the time-of-day wallpaper on. */
export function AppearanceEffects() {
  const load = useAppearance((s) => s.load)
  const wallpaper = useAppearance((s) => s.appearance.wallpaper)

  useEffect(() => {
    load()
    const onStorage = (e: StorageEvent) => {
      if (e.key === "agentroom.appearance") load()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [load])

  // One timer for the next 06:00 / 12:00 / 18:00 switch, re-armed after each.
  useEffect(() => {
    if (wallpaper !== "time") return
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      timer = setTimeout(() => {
        applyAppearance(useAppearance.getState().appearance)
        arm()
      }, msToNextSwitch() + 1000)
    }
    arm()
    return () => clearTimeout(timer)
  }, [wallpaper])

  return null
}
