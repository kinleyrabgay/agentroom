import { describe, expect, it } from 'vitest';
import { SkillScope } from '../src/shared/enums.js';
import { expandSkillCommands } from '../src/server/agents/skill-commands.js';
import type { Bot, Skill } from '../src/shared/types/index.js';

const skill = (name: string, body = `${name} body`): Skill => ({ name, description: '', body, scope: SkillScope.Library });
const library = [skill('testing'), skill('planning', 'Plan carefully.')];
const bot = { id: 'qa', skills: ['testing'], localSkills: [{ ...skill('cart-smoke'), scope: SkillScope.Bot, botId: 'qa' }] } as unknown as Bot;

describe('expandSkillCommands', () => {
  it('turns assigned and own skills into instructions', () => {
    expect(expandSkillCommands(bot, '/testing check the cart', library)).toBe('Use the `agentroom:testing` skill for this.\n\ncheck the cart');
    expect(expandSkillCommands(bot, '/cart-smoke', library)).toBe('Use the `agentroom-bot-qa:cart-smoke` skill for this.');
  });
  it('inlines unassigned library skills and keeps unknown tokens', () => {
    const out = expandSkillCommands(bot, '/planning /nope do it', library);
    expect(out).toContain('Apply the "planning" skill');
    expect(out).toContain('Plan carefully.');
    expect(out.endsWith('/nope do it')).toBe(true);
  });
  it('leaves normal messages alone', () => {
    expect(expandSkillCommands(bot, 'run /testing later', library)).toBe('run /testing later');
    expect(expandSkillCommands(bot, '/unknown thing', library)).toBe('/unknown thing');
  });
});
