import { describe, expect, it } from 'vitest';
import { applyRateLimit, applyUsage, emptyUsage, totalTokens } from '../src/shared/usage/reducer.js';

const report = (botId: string, model: string, n: number) => ({
  botId, provider: 'claude', model, input: n, output: n * 2, cacheRead: n * 10, cacheWrite: n * 3, costUsd: n / 1000, runs: 1,
  contextWindow: 200000, contextUsed: n * 13,
});

describe('usage reducer', () => {
  it('aggregates totals, providers, models and bots', () => {
    let s = emptyUsage(0);
    s = applyUsage(s, report('qa', 'claude-haiku', 100));
    s = applyUsage(s, report('qa', 'claude-haiku', 50));
    s = applyUsage(s, report('dev', 'claude-opus', 10));
    expect(s.totals.runs).toBe(3);
    expect(totalTokens(s.totals)).toBe(160 * 16);
    expect(s.byProvider.claude.input).toBe(160);
    expect(s.byModel['claude-haiku'].output).toBe(300);
    expect(s.byBot.qa).toMatchObject({ runs: 2, contextUsed: 650, contextWindow: 200000, model: 'claude-haiku' });
  });

  it('keeps the latest status per limit window', () => {
    let s = emptyUsage(0);
    s = applyRateLimit(s, { provider: 'claude', window: 'five_hour', status: 'allowed', utilization: 0.2 });
    s = applyRateLimit(s, { provider: 'claude', window: 'five_hour', status: 'allowed_warning', utilization: 0.85 });
    s = applyRateLimit(s, { provider: 'claude', window: 'seven_day', status: 'allowed', utilization: 0.4 });
    expect(Object.keys(s.limits)).toHaveLength(2);
    expect(s.limits['claude:five_hour'].utilization).toBe(0.85);
  });
});
