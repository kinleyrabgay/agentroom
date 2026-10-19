"use client"

import type { Bot } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { useModels } from "../hooks/use-models"
import { effectiveModel, formatModel } from "../lib/models"

/** "Sonnet 5.5 · High" for a bot, resolving project defaults. */
export function useBotModelLabel(bot: Bot) {
  const { models } = useModels()
  const config = useAppStore((s) => s.info?.config)
  return formatModel(effectiveModel(models, bot, config))
}

export function ModelLabel({ bot, className }: { bot: Bot; className?: string }) {
  return <span className={className}>{useBotModelLabel(bot)}</span>
}
