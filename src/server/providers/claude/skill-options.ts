import { BOT_PLUGIN_PREFIX, LIBRARY_PLUGIN } from '../../../shared/constants.js';
import { ToolName } from '../../../shared/enums.js';
import type { Bot } from '../../../shared/types/index.js';
import type { SkillLocations } from '../provider.js';

export interface ClaudeSkillOptions {
  /** Built-in tools, with `Browser` removed (it's a host tool) and `Skill` added when needed. */
  tools: string[];
  plugins: { type: 'local'; path: string; skipMcpDiscovery: true }[];
  /** Fully qualified skill names the bot may load. */
  skills: string[];
}

/**
 * Library skills come from the `.agentroom/` plugin (`agentroom:<name>`); a bot's own skills
 * come from its folder as a plugin (`agentroom-bot-<id>:<name>`). Pure, for testability.
 */
export function buildSkillOptions(bot: Bot, locations: SkillLocations): ClaudeSkillOptions {
  const plugins: ClaudeSkillOptions['plugins'] = [{ type: 'local', path: locations.libraryPluginDir, skipMcpDiscovery: true }];
  if (bot.localSkills.length) plugins.push({ type: 'local', path: locations.botPluginDir, skipMcpDiscovery: true });

  const skills = [
    ...bot.skills.map((s) => `${LIBRARY_PLUGIN}:${s}`),
    ...bot.localSkills.map((s) => `${BOT_PLUGIN_PREFIX}${bot.id}:${s.name}`),
  ];

  const tools = bot.tools.filter((t) => t !== ToolName.Browser);
  if (skills.length && !tools.includes(ToolName.Skill)) tools.push(ToolName.Skill);
  return { tools, plugins, skills };
}
