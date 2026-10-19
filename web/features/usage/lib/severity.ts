import { RateLimitStatus, type RateLimit } from "@shared"
import { CRITICAL_AT, WARNING_AT } from "../constants"

export const Severity = { Ok: "ok", Warning: "warning", Critical: "critical" } as const
export type Severity = (typeof Severity)[keyof typeof Severity]

/** From a 0-100 percentage. */
export function percentSeverity(p: number): Severity {
  return p >= CRITICAL_AT * 100 ? Severity.Critical : p >= WARNING_AT * 100 ? Severity.Warning : Severity.Ok
}

export function limitSeverity(l: RateLimit): Severity {
  const u = l.utilization ?? 0
  if (l.status === RateLimitStatus.Rejected || u >= CRITICAL_AT) return Severity.Critical
  if (l.status === RateLimitStatus.Warning || u >= WARNING_AT) return Severity.Warning
  return Severity.Ok
}

/** The rate limit with the highest utilization, if any reported one. */
export function worstLimit(limits: RateLimit[]) {
  return limits.filter((l) => l.utilization !== undefined).sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0]
}
