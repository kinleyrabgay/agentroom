import { describe, expect, it } from 'vitest';
import { buildSkillOptions } from '../src/server/providers/claude/skill-options.js';
import { toModelOption } from '../src/server/providers/claude/model-options.js';
import { SkillScope } from '../src/shared/enums.js';
import type { Bot } from '../src/shared/types/index.js';

const bot = (patch: Partial<Bot> = {}): Bot => ({
  id: 'qa', dir: '04-qa', order: 4, name: 'QA', role: 'qa', color: '#000', avatar: 'x', prompt: '',
  tools: ['Read', 'Bash', 'Browser'], skills: [], localSkills: [], ...patch,
});
const loc = { libraryPluginDir: '/p/.agentroom', botPluginDir: '/p/.agentroom/bots/04-qa' };

describe('buildSkillOptions', () => {
  it('strips the Browser host tool and adds nothing without skills', () => {
    expect(buildSkillOptions(bot(), loc)).toEqual({
      tools: ['Read', 'Bash'],
      plugins: [{ type: 'local', path: loc.libraryPluginDir, skipMcpDiscovery: true }],
      skills: [],
    });
  });

  it('qualifies library and bot skills and loads the bot plugin only when needed', () => {
    const o = buildSkillOptions(
      bot({ skills: ['testing'], localSkills: [{ name: 'e2e', description: '', body: '', scope: SkillScope.Bot, botId: 'qa' }] }),
      loc,
    );
    expect(o.skills).toEqual(['agentroom:testing', 'agentroom-bot-qa:e2e']);
    expect(o.plugins.map((p) => p.path)).toEqual([loc.libraryPluginDir, loc.botPluginDir]);
    expect(o.tools).toContain('Skill');
  });
});

describe('toModelOption', () => {
  it('maps SDK model info and effort levels', () => {
    expect(
      toModelOption({ value: 'sonnet', displayName: 'Sonnet', description: 'Fast', resolvedModel: 'claude-sonnet-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }),
    ).toEqual({ value: 'sonnet', label: 'Sonnet', description: 'Fast', resolvedModel: 'claude-sonnet-5-5', efforts: ['low', 'high'] });
    expect(toModelOption({ value: 'haiku', displayName: '', description: '', supportsEffort: false, supportedEffortLevels: ['low'] })).toEqual({
      value: 'haiku', label: 'haiku', description: '', efforts: [],
    });
    expect(toModelOption({ value: 'x', displayName: 'X', description: '', supportedEffortLevels: ['low'] }).efforts).toEqual([]);
  });
});
