import { cn } from "@/lib/utils"
import { SEVERITY_META } from "../constants"
import type { FindingCounts } from "../lib/findings"

/** Summary strip: label (sentence case) + value; the two open counts carry their severity icon. */
export function StatTiles({ counts }: { counts: FindingCounts }) {
  const crit = SEVERITY_META.critical
  const warn = SEVERITY_META.warning
  const tiles: { label: string; value: number; icon?: typeof crit.icon; tone?: string }[] = [
    { label: "Open critical", value: counts.openCritical, icon: crit.icon, tone: counts.openCritical ? crit.text : undefined },
    { label: "Open warnings", value: counts.openWarning, icon: warn.icon, tone: counts.openWarning ? warn.text : undefined },
    { label: "Risk approved", value: counts.approved },
    { label: "Dismissed", value: counts.dismissed },
    { label: "Fixed", value: counts.fixed },
  ]
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map(({ label, value, icon: Icon, tone }) => (
        <div key={label} className="rounded-xl border bg-card px-3 py-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {Icon && <Icon className={cn("size-3.5", tone)} />}
            {label}
          </dt>
          <dd className={cn("mt-0.5 text-2xl font-semibold tabular-nums", tone)}>{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  )
}
