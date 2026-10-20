import { create } from "zustand"
import type { Settings } from "@shared"
import { SettingsSection } from "./constants"

export type SaveScope = "team" | "personal"

/** Where Settings edits are saved: the team file (committed) or your personal overlay. */
export const useSaveScope = create<{ scope: SaveScope; set: (s: SaveScope) => void }>((set) => ({
  scope: "team",
  set: (scope) => set({ scope }),
}))

/** Settings key each section edits (sections without one are personal or not stored in settings.json). */
export const SECTION_KEY: Partial<Record<SettingsSection, keyof Settings>> = {
  [SettingsSection.General]: "models",
  [SettingsSection.Budgets]: "budgets",
  [SettingsSection.Security]: "security",
  [SettingsSection.Context]: "context",
  [SettingsSection.Integrations]: "digest" as keyof Settings,
  [SettingsSection.Data]: "audit",
}

const NO_OVERRIDES: string[] = []

/** Dotted keys overridden personally (sent with the settings by the server). */
export const overridesOf = (settings: Settings | null): string[] =>
  (settings as (Settings & { overrides?: unknown }) | null)?.overrides instanceof Array
    ? ((settings as Settings & { overrides: string[] }).overrides)
    : NO_OVERRIDES
