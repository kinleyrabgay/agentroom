import type { FindingSeverity } from "@shared"
import { ToneBadge } from "@/components/kit/badge"
import { SEVERITY_META } from "../constants"

/** Severity chip: icon + label, colour as a secondary cue. */
export function SeverityBadge({ severity, className }: { severity: FindingSeverity; className?: string }) {
  const meta = SEVERITY_META[severity]
  return (
    <ToneBadge tone={meta.tone} icon={meta.icon} className={className}>
      {meta.label}
    </ToneBadge>
  )
}
