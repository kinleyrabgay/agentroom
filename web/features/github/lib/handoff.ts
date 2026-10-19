import type { Bot } from "@shared"

const BOT_TOKEN = /(^|\s)\/([a-z0-9][a-z0-9-]*)(?=\s|$)/g
const FILE_TOKEN = /(^|\s)@([^\s@]+)/g

/** The first `/bot-id` in the text that names a real bot. */
export function targetBot(text: string, bots: Bot[]): Bot | undefined {
  for (const m of text.matchAll(BOT_TOKEN)) {
    const bot = bots.find((b) => b.id === m[2])
    if (bot) return bot
  }
  return undefined
}

/** `@path` tokens, in order, without duplicates. */
export function fileTokens(text: string): string[] {
  return [...new Set([...text.matchAll(FILE_TOKEN)].map((m) => m[2]))]
}

/** The note without the routing token and file tokens (files are sent separately). */
export function noteText(text: string, bot: Bot | undefined): string {
  let out = text.replace(FILE_TOKEN, "$1")
  if (bot) out = out.replace(new RegExp(`(^|\\s)/${bot.id}(?=\\s|$)`), "$1")
  return out.replace(/[ \t]+\n/g, "\n").replace(/\s{2,}/g, " ").trim()
}

export function removeFileToken(text: string, path: string): string {
  return text
    .split(/(\s+)/)
    .filter((part) => part !== `@${path}`)
    .join("")
    .replace(/\s{2,}/g, " ")
}

export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())
