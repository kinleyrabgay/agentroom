import type { ContextCardStatus } from "@shared"
import type { Tone } from "@/components/kit/tone"

export const CARD_STATUS: Record<ContextCardStatus, { label: string; tone: Tone; hint: string }> = {
  fresh: { label: "Up to date", tone: "success", hint: "The card matches the code." },
  stale: { label: "Stale", tone: "warning", hint: "The code changed since the card was written. Bots are told to verify it." },
  missing: { label: "No card", tone: "neutral", hint: "Bots get the facts (files, symbols, deps) but no summary yet." },
}

/** Last folder of a module's path, the name people know it by. */
export function moduleName(m: { id: string; dir: string }) {
  if (!m.dir) return "(repo root)"
  const parts = m.dir.split("/")
  return parts[parts.length - 1]!
}

export const SECTION_TITLES = {
  entryPoints: "Entry points",
  invariants: "Invariants",
  gotchas: "Gotchas",
  howToChange: "How to change",
} as const
