import { describe, expect, it } from 'vitest';
import { decide, matchesAlwaysAsk } from '../src/server/safety/permission-policy.js';
import { ConfigSchema } from '../src/shared/schemas.js';
import type { Config } from '../src/shared/types/index.js';

const cfg = (patch: Partial<Config> = {}) => ConfigSchema.parse({ alwaysAsk: ['git push', 'rm -rf', 'gh pr merge'], ...patch });

describe('matchesAlwaysAsk', () => {
  it('matches first and chained segments', () => {
    expect(matchesAlwaysAsk('git push origin main', ['git push'])).toBe('git push');
    expect(matchesAlwaysAsk('npm test && git push', ['git push'])).toBe('git push');
    expect(matchesAlwaysAsk('FOO=1 sudo rm -rf /tmp/x', ['rm -rf'])).toBe('rm -rf');
  });
  it('ignores lookalikes', () => {
    expect(matchesAlwaysAsk('git pushx', ['git push'])).toBeNull();
    expect(matchesAlwaysAsk('echo "git push"', ['git push'])).toBeNull();
  });
});

describe('decide', () => {
  it('allows host tools and reads in ask-writes', () => {
    expect(decide('mcp__agentroom__delegate', {}, cfg(), new Set()).action).toBe('allow');
    expect(decide('Read', { file_path: 'a' }, cfg(), new Set()).action).toBe('allow');
  });
  it('asks for writes and bash unless session-allowed', () => {
    expect(decide('Edit', {}, cfg(), new Set()).action).toBe('ask');
    expect(decide('Edit', {}, cfg(), new Set(['Edit'])).action).toBe('allow');
    expect(decide('Bash', { command: 'ls' }, cfg(), new Set()).action).toBe('ask');
  });
  it('always asks for dangerous commands, even in auto mode or session-allowed', () => {
    const d = decide('Bash', { command: 'git push' }, cfg({ permissionMode: 'auto' }), new Set(['Bash']));
    expect(d).toMatchObject({ action: 'ask', sticky: true });
  });
  it('browser: reading allowed, acting asks, always-allow covers all browser actions', () => {
    expect(decide('mcp__agentroom__browser_open', { url: 'x' }, cfg(), new Set()).action).toBe('allow');
    expect(decide('mcp__agentroom__browser_click', {}, cfg(), new Set())).toMatchObject({ action: 'ask', group: 'Browser' });
    expect(decide('mcp__agentroom__browser_type', {}, cfg(), new Set(['Browser'])).action).toBe('allow');
  });
  it('ask-all asks for reads', () => {
    expect(decide('Read', {}, cfg({ permissionMode: 'ask-all' }), new Set()).action).toBe('ask');
  });
});
