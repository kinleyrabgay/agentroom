import { OctagonAlertIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Severity } from "../lib/severity"

/** Icon + label so severity is never conveyed by color alone. */
export function SeverityTag({ severity, label }: { severity: Severity; label?: string }) {
  if (severity === Severity.Ok) return null
  const critical = severity === Severity.Critical
  return (
    <span className={cn("flex items-center gap-0.5 text-[10px] font-normal", critical ? "text-[var(--status-critical)]" : "text-[var(--status-warning-text)]")}>
      {critical ? <OctagonAlertIcon className="size-3" /> : <TriangleAlertIcon className="size-3" />}
      {label ?? (critical ? "Almost out" : "Running high")}
    </span>
  )
}
