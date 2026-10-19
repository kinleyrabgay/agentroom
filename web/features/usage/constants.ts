import { ProviderId, RateLimitStatus, type TokenCounts } from "@shared"

export const WARNING_AT = 0.7
export const CRITICAL_AT = 0.9
export const CLOCK_TICK_MS = 30_000

export const WINDOW_LABEL: Record<string, string> = {
  five_hour: "5-hour session",
  seven_day: "Weekly",
  seven_day_opus: "Weekly · Opus",
  seven_day_sonnet: "Weekly · Sonnet",
  seven_day_overage_included: "Weekly · incl. extra usage",
  overage: "Extra usage",
}

export const LIMIT_STATUS_TEXT: Record<RateLimitStatus, string> = {
  [RateLimitStatus.Allowed]: "Within limit",
  [RateLimitStatus.Warning]: "Approaching limit",
  [RateLimitStatus.Rejected]: "Limit reached",
}

/** Token kinds in validated categorical slot order (adjacent pairs pass CVD + normal-vision checks). */
export const TOKEN_KINDS: { key: keyof Omit<TokenCounts, "costUsd" | "runs">; label: string; color: string }[] = [
  { key: "input", label: "Input", color: "var(--tok-1)" },
  { key: "cacheWrite", label: "Cache write", color: "var(--tok-2)" },
  { key: "cacheRead", label: "Cache read", color: "var(--tok-3)" },
  { key: "output", label: "Output", color: "var(--tok-4)" },
]

export const isClaude = (provider: string | undefined) => (provider ?? ProviderId.Claude) === ProviderId.Claude
