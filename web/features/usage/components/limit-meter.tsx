import { RateLimitStatus, type RateLimit } from "@shared"
import { LIMIT_STATUS_TEXT, WINDOW_LABEL } from "../constants"
import { pct, resetsIn } from "../lib/format"
import { limitSeverity } from "../lib/severity"
import { MeterBar, toneFor } from "./meter-bar"
import { SeverityTag } from "./severity-tag"

/** A limit reported live during a run (fallback when account usage is unavailable). */
export function LimitMeter({ limit, now, claude }: { limit: RateLimit; now: number; claude: boolean }) {
  const sev = limitSeverity(limit)
  const reset = resetsIn(limit.resetsAt ? limit.resetsAt * 1000 : undefined, now)
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          {WINDOW_LABEL[limit.window] ?? limit.window}
          <SeverityTag severity={sev} label={limit.status === RateLimitStatus.Rejected ? "Limit reached" : undefined} />
          {limit.usingOverage && <span className="text-xs font-normal text-muted-foreground">· using extra usage</span>}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {limit.utilization !== undefined ? `${pct(limit.utilization)} used` : LIMIT_STATUS_TEXT[limit.status]}
          {reset ? ` · ${reset}` : ""}
        </span>
      </div>
      {limit.utilization !== undefined && <MeterBar value={limit.utilization} tone={toneFor(sev, claude)} />}
    </div>
  )
}
