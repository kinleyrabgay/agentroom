import type { Bot, Skill } from "@shared"
import { fuzzyScore, type Suggestion } from "@/components/shared/mention-textarea"

const MAX = 30

/**
 * `/` suggestions in a bot's chat: its own skills, then its assigned library skills,
 * then the rest of the library (dimmed — the server only expands skills the bot has).
 */
export function skillSuggestions(bot: Bot, library: Skill[], query: string): Suggestion[] {
  const own = bot.localSkills.map((s) => ({ s, rank: 0, hint: "own" }))
  const assigned = library.filter((s) => bot.skills.includes(s.name)).map((s) => ({ s, rank: 1, hint: "" }))
  const others = library
    .filter((s) => !bot.skills.includes(s.name) && !bot.localSkills.some((l) => l.name === s.name))
    .map((s) => ({ s, rank: 2, hint: "not assigned" }))

  return [...own, ...assigned, ...others]
    .map((x) => ({ ...x, score: fuzzyScore(x.s.name, query) }))
    .filter((x): x is typeof x & { score: number } => x.score !== null)
    .sort((a, b) => a.rank - b.rank || a.score - b.score || a.s.name.localeCompare(b.s.name))
    .slice(0, MAX)
    .map(({ s, rank, hint }) => ({
      id: `${rank}:${s.name}`,
      insert: `/${s.name}`,
      label: `/${s.name}`,
      description: s.description,
      hint: hint || undefined,
      muted: rank === 2,
    }))
}
