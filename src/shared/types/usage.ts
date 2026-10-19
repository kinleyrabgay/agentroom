import type { RateLimitStatus } from '../enums.js';

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  runs: number;
}

/** One run's usage for one model, emitted when a run finishes. */
export interface UsageReport extends TokenCounts {
  botId: string;
  provider: string;
  model: string;
  /** Model context window, when the provider reports it. */
  contextWindow?: number;
  /** Prompt tokens on the last turn, i.e. how full the context window is. */
  contextUsed?: number;
}

/** Live plan-limit status reported during a run (Claude subscriptions). */
export interface RateLimit {
  provider: string;
  /** e.g. five_hour, seven_day, seven_day_opus */
  window: string;
  status: RateLimitStatus;
  /** 0..1 */
  utilization?: number;
  /** Epoch seconds. */
  resetsAt?: number;
  usingOverage?: boolean;
}

/** AgentRoom's own spend, aggregated. */
export interface UsageSummary {
  since: number;
  totals: TokenCounts;
  byProvider: Record<string, TokenCounts>;
  byModel: Record<string, TokenCounts & { provider: string; contextWindow?: number }>;
  byBot: Record<string, TokenCounts & { model?: string; contextWindow?: number; contextUsed?: number }>;
  limits: Record<string, RateLimit>;
}

/** One plan window as Claude Code's `/usage` reports it (account-wide, all apps). */
export interface PlanWindow {
  key: string;
  label: string;
  /** 0-100 */
  percent: number;
  /** Epoch ms. */
  resetsAt?: number;
}

/** Account-wide plan usage, fetched from the provider. */
export interface AccountUsage {
  fetchedAt: number;
  /** 'pro' | 'max' | 'team' | 'enterprise', or null for API keys / cloud providers. */
  plan: string | null;
  organization: string | null;
  /** False when plan limits don't apply (API key, Bedrock, Vertex). */
  available: boolean;
  windows: PlanWindow[];
  extraUsage: { usedCredits: number | null; monthlyLimit: number | null; percent: number | null; currency: string | null } | null;
}
