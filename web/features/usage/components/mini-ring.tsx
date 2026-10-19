import { pct } from "../lib/format"
import { Severity } from "../lib/severity"

/** Tiny progress ring for the top-bar pill. */
export function MiniRing({ value, severity, claude }: { value: number; severity: Severity; claude: boolean }) {
  const r = 6
  const c = 2 * Math.PI * r
  const color =
    severity === Severity.Critical ? "var(--status-critical)" : severity === Severity.Warning ? "var(--status-warning)" : claude ? "var(--claude)" : "currentColor"
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="-mr-0.5 -rotate-90" aria-label={`Plan limit ${pct(value)} used`}>
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="stroke-border" />
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" stroke={color} strokeLinecap="round" strokeDasharray={`${c * Math.min(1, value)} ${c}`} />
    </svg>
  )
}
