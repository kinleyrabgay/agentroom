"use client"

import { useEffect, useState } from "react"
import type { ScheduleWhen, TimeParse } from "@shared"
import { automationApi } from "@/lib/api/endpoints"

const DEBOUNCE_MS = 400

/**
 * Spots a time in what the human types ("…tomorrow at 9") and turns it into a ScheduleWhen.
 * The human can change it (`setWhen`) or ignore it (`dismiss`), until the text changes.
 */
export function useTimePhrase(text: string) {
  const [found, setFound] = useState<{ text: string; parse: TimeParse } | null>(null)
  const [override, setOverride] = useState<{ text: string; when: ScheduleWhen } | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    const value = text
    if (!/\d|tomorrow|tonight|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|every|daily|hour|minute|week|noon/i.test(value)) return
    const t = setTimeout(() => {
      automationApi
        .parse(value)
        .then((parse) => setFound({ text: value, parse }))
        .catch(() => {})
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text])

  const parse = found && found.text === text && found.parse.at ? found.parse : null
  const when: ScheduleWhen | null = override && override.text === text ? override.when : parse ? (parse.recurring ? { type: "cron", ...parse.recurring } : { type: "once", at: parse.at! }) : null
  const active = !!when && dismissed !== text && !!parse

  return {
    active,
    when,
    phrase: parse?.phrase ?? null,
    rest: parse?.rest ?? text,
    setWhen: (w: ScheduleWhen) => setOverride({ text, when: w }),
    dismiss: () => setDismissed(text),
  }
}
