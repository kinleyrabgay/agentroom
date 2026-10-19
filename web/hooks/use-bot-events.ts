"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store/app-store"
import { botEvents } from "@/lib/store/selectors"

export function useBotEvents(botId: string) {
  const events = useAppStore((s) => s.events)
  return useMemo(() => botEvents(events, botId), [events, botId])
}
