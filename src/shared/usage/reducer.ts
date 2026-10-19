/** Pure usage aggregation, shared by server and UI so both build the same summary from the same events. */
import type { RateLimit, TokenCounts, UsageReport, UsageSummary } from '../types/usage.js';

export const zeroCounts = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, runs: 0 });

export function emptyUsage(since = Date.now()): UsageSummary {
  return { since, totals: zeroCounts(), byProvider: {}, byModel: {}, byBot: {}, limits: {} };
}

export const totalTokens = (c: TokenCounts) => c.input + c.output + c.cacheRead + c.cacheWrite;

const add = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  costUsd: a.costUsd + b.costUsd,
  runs: a.runs + b.runs,
});

const countsOf = (r: TokenCounts): TokenCounts => ({
  input: r.input,
  output: r.output,
  cacheRead: r.cacheRead,
  cacheWrite: r.cacheWrite,
  costUsd: r.costUsd,
  runs: r.runs,
});

export function applyUsage(s: UsageSummary, r: UsageReport): UsageSummary {
  const counts = countsOf(r);
  const prevModel = s.byModel[r.model];
  const prevBot = s.byBot[r.botId];
  return {
    ...s,
    totals: add(s.totals, counts),
    byProvider: { ...s.byProvider, [r.provider]: add(s.byProvider[r.provider] ?? zeroCounts(), counts) },
    byModel: {
      ...s.byModel,
      [r.model]: { ...add(prevModel ?? zeroCounts(), counts), provider: r.provider, contextWindow: r.contextWindow ?? prevModel?.contextWindow },
    },
    byBot: {
      ...s.byBot,
      [r.botId]: {
        ...add(prevBot ?? zeroCounts(), counts),
        model: r.model,
        contextWindow: r.contextWindow ?? prevBot?.contextWindow,
        contextUsed: r.contextUsed ?? prevBot?.contextUsed,
      },
    },
  };
}

export function applyRateLimit(s: UsageSummary, l: RateLimit): UsageSummary {
  return { ...s, limits: { ...s.limits, [`${l.provider}:${l.window}`]: l } };
}
