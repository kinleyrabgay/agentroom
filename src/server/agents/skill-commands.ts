import { BOT_PLUGIN_PREFIX, LIBRARY_PLUGIN } from '../../shared/constants.js';
import type { Bot, Skill } from '../../shared/types/index.js';

/** Matches leading `/skill` tokens, e.g. "/testing /code-review check the cart". */
const LEADING_COMMANDS = /^(\s*\/[a-z0-9][a-z0-9-]*)+/;

/**
 * Expand `/skill` commands at the start of a chat message into an explicit instruction.
 * The bot's own skills win over library skills of the same name. A library skill the bot isn't
 * assigned isn't loaded for it, so its instructions are inlined instead. Unknown tokens stay as typed.
 */
export function expandSkillCommands(bot: Bot, text: string, library: Skill[]): string {
  const m = LEADING_COMMANDS.exec(text);
  if (!m) return text;
  const tokens = m[0].trim().split(/\s+/).map((t) => t.slice(1));
  const rest = text.slice(m[0].length).trim();

  const lines: string[] = [];
  const unknown: string[] = [];
  for (const name of tokens) {
    const own = bot.localSkills.find((s) => s.name === name);
    if (own) {
      lines.push(`Use the \`${BOT_PLUGIN_PREFIX}${bot.id}:${name}\` skill for this.`);
      continue;
    }
    const lib = library.find((s) => s.name === name);
    if (!lib) {
      unknown.push(`/${name}`);
      continue;
    }
    if (bot.skills.includes(name)) lines.push(`Use the \`${LIBRARY_PLUGIN}:${name}\` skill for this.`);
    else lines.push(`Apply the "${name}" skill for this (it isn't loaded for you, so here are its instructions):\n\n${lib.body.trim()}`);
  }
  if (!lines.length) return text;
  const remainder = [unknown.join(' '), rest].filter(Boolean).join(' ');
  return [lines.join('\n'), remainder].filter(Boolean).join('\n\n');
}
