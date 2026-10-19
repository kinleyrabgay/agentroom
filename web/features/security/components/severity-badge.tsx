import type { FindingSeverity } from "@shared"
import { cn } from "@/lib/utils"
import { SEVERITY_META } from "../constants"

/** Severity chip: icon + label, color as a secondary cue. */
export function SeverityBadge({ severity, className }: { severity: FindingSeverity; className?: string }) {
  const meta = SEVERITY_META[severity]
  const Icon = meta.icon
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.chip, className)}>
      <Icon className="size-3" /> {meta.label}
    </span>
  )
}
