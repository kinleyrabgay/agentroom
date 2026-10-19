import type { Bot } from "@shared"
import type { BotUpdate } from "@/lib/api/endpoints"

/**
 * Build the PATCH body for the bot config form. JSON drops `undefined`, so fields the user
 * cleared are sent as `null`, which tells the server to remove them.
 */
export function toBotUpdate(draft: Bot): BotUpdate {
  return {
    name: draft.name,
    role: draft.role,
    color: draft.color,
    avatar: draft.avatar,
    tools: draft.tools,
    prompt: draft.prompt,
    model: draft.model ?? null,
    effort: draft.effort ?? null,
    reportsTo: draft.reportsTo ?? null,
  }
}
