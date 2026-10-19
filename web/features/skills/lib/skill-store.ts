import { PROJECT_DIR, SkillScope, type Bot, type SkillInput } from "@shared"
import { botApi, skillApi } from "@/lib/api/endpoints"

/** Where a skill is saved. The dialog works the same for both; only this strategy differs. */
export type SkillTarget = { scope: typeof SkillScope.Library } | { scope: typeof SkillScope.Bot; bot: Bot }

export interface SkillStore {
  save(skill: SkillInput): Promise<unknown>
  remove(name: string): Promise<unknown>
  /** Human-readable location of a skill file. */
  pathOf(name: string): string
}

export function skillStoreFor(target: SkillTarget): SkillStore {
  if (target.scope === SkillScope.Library) {
    return {
      save: (s) => skillApi.save(s),
      remove: (name) => skillApi.remove(name),
      pathOf: (name) => `${PROJECT_DIR}/skills/${name || "<name>"}/SKILL.md`,
    }
  }
  const { bot } = target
  return {
    save: (s) => botApi.saveSkill(bot.id, s),
    remove: (name) => botApi.deleteSkill(bot.id, name),
    pathOf: (name) => `${PROJECT_DIR}/bots/${bot.dir}/skills/${name || "<name>"}/SKILL.md`,
  }
}

export const NEW_SKILL: SkillInput = { name: "", description: "", body: "# New skill\n\n" }
