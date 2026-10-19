import type { z } from 'zod';
import type { BotFrontmatterSchema } from '../schemas.js';
import type { Skill } from './skill.js';

export type BotFrontmatter = z.infer<typeof BotFrontmatterSchema>;

export interface Bot extends BotFrontmatter {
  /** Stable id: folder name without its order prefix, e.g. "team-lead". */
  id: string;
  /** Folder name, e.g. "01-team-lead". */
  dir: string;
  /** Position on the team canvas (from the folder prefix). */
  order: number;
  /** Persona / system prompt (the body of bot.md). */
  prompt: string;
  /** Skills that live in this bot's own folder (`bots/<dir>/skills/`). */
  localSkills: Skill[];
}

/** Fields the UI may change. Identity fields are derived from the folder. */
export type BotPatch = Partial<Omit<Bot, 'id' | 'dir' | 'order' | 'localSkills'>>;

export interface NewBotInput {
  name: string;
  role?: string;
  reportsTo?: string;
}
