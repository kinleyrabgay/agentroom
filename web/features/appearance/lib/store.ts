"use client"

import { create } from "zustand"
import { applyAppearance, DEFAULT_APPEARANCE, loadAppearance, saveAppearance, type Appearance } from "./appearance"

interface AppearanceStore {
  appearance: Appearance
  /** False when the last change couldn't be saved (storage full); it still applies to this tab. */
  saved: boolean
  /** Read this browser's saved look (on mount, or when another tab changed it). */
  load: () => void
  update: (patch: Partial<Appearance>) => void
  reset: () => void
}

export const useAppearance = create<AppearanceStore>((set, get) => ({
  appearance: DEFAULT_APPEARANCE,
  saved: true,
  load: () => {
    const appearance = loadAppearance()
    set({ appearance })
    applyAppearance(appearance)
  },
  update: (patch) => {
    const appearance = { ...get().appearance, ...patch }
    applyAppearance(appearance)
    set({ appearance, saved: saveAppearance(appearance) })
  },
  reset: () => get().update({ ...DEFAULT_APPEARANCE, customImage: undefined, customHue: undefined }),
}))
