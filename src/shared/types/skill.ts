import type { SkillScope } from '../enums.js';

export interface Skill {
  name: string;
  /** When a bot should use it. Shown to the model, so be specific. */
  description: string;
  /** Markdown instructions (the body of SKILL.md). */
  body: string;
  scope: SkillScope;
  /** Owner bot, for bot-scoped skills. */
  botId?: string;
}

export type SkillInput = Pick<Skill, 'name' | 'description' | 'body'>;
