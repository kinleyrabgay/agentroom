import { toast } from "sonner"
import type { Bot } from "@shared"
import { botApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"

const fail = (e: unknown) => toast.error((e as Error).message)

/** How long a newly added skill chip glows on the canvas. */
export const SKILL_HIGHLIGHT_MS = 1800
let highlightTimer: ReturnType<typeof setTimeout> | undefined

/** Mark a chip as just added; the store clears it after SKILL_HIGHLIGHT_MS. */
function highlightSkill(botId: string, skill: string) {
  const at = Date.now()
  useAppStore.setState({ recentSkill: { botId, skill, at } })
  clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    if (useAppStore.getState().recentSkill?.at === at) useAppStore.setState({ recentSkill: null })
  }, SKILL_HIGHLIGHT_MS)
}

/** Add a library skill to a bot, with an Undo toast and a chip highlight. */
export async function assignSkill(bot: Bot, skill: string) {
  if (bot.skills.includes(skill)) return
  try {
    await botApi.assignSkill(bot, skill)
    highlightSkill(bot.id, skill)
    toast.success(`Added ${skill} to ${bot.name}`, {
      action: { label: "Undo", onClick: () => unassignQuietly(bot.id, skill) },
    })
  } catch (e) {
    fail(e)
  }
}

/** Remove a library skill from a bot, with an Undo toast. */
export async function unassignSkill(bot: Bot, skill: string) {
  try {
    await botApi.unassignSkill(bot, skill)
    toast(`Removed ${skill} from ${bot.name}`, {
      action: { label: "Undo", onClick: () => assignQuietly(bot.id, skill) },
    })
  } catch (e) {
    fail(e)
  }
}

// Undo works against the latest bot state, not the one captured when the toast was shown.
const latest = (botId: string) => useAppStore.getState().bots.find((b) => b.id === botId)

function unassignQuietly(botId: string, skill: string) {
  const bot = latest(botId)
  if (bot) botApi.unassignSkill(bot, skill).catch(fail)
}

function assignQuietly(botId: string, skill: string) {
  const bot = latest(botId)
  if (bot) botApi.assignSkill(bot, skill).catch(fail)
}
