import type { PlanWindow } from "@shared"
import { resetsIn } from "../lib/format"
import { percentSeverity } from "../lib/severity"
import { MeterBar, toneFor } from "./meter-bar"
import { SeverityTag } from "./severity-tag"

/** One account-wide plan window (session, weekly, per-model). */
export function PlanMeter({ window: w, now }: { window: PlanWindow; now: number }) {
  const sev = percentSeverity(w.percent)
  const reset = resetsIn(w.resetsAt, now)
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          {w.label}
          <SeverityTag severity={sev} />
        </span>
        <span className="text-muted-foreground tabular-nums">
          {Math.round(w.percent)}% used{reset ? ` · ${reset}` : ""}
        </span>
      </div>
      <MeterBar value={w.percent / 100} tone={toneFor(sev, true)} />
    </div>
  )
}
