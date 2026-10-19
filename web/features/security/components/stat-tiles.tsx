import { cn } from "@/lib/utils"
import { TONE_CLASS } from "@/components/kit/tone"
import { SEVERITY_META } from "../constants"
import type { FindingCounts } from "../lib/findings"

/** Summary strip, quiet by default: only open counts above zero take their severity colour. */
export function StatTiles({ counts }: { counts: FindingCounts }) {
  const crit = SEVERITY_META.critical
  const warn = SEVERITY_META.warning
  const tiles = [
    { label: "Open critical", value: counts.openCritical, icon: crit.icon, tone: counts.openCritical ? crit.tone : null },
    { label: "Open warnings", value: counts.openWarning, icon: warn.icon, tone: counts.openWarning ? warn.tone : null },
    { label: "Risk approved", value: counts.approved },
    { label: "Dismissed", value: counts.dismissed },
    { label: "Fixed", value: counts.fixed },
  ]
  return (
    <dl className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-card sm:grid-cols-5 sm:divide-y-0">
      {tiles.map(({ label, value, icon: Icon, tone }) => (
        <div key={label} className={cn("px-4 py-3", tone && TONE_CLASS[tone])}>
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {Icon && <Icon className={cn("size-3.5", tone && "tone-text")} aria-hidden />}
            {label}
          </dt>
          <dd className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", tone ? "tone-text" : value ? "" : "text-muted-foreground/70")}>
            {value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  )
}
