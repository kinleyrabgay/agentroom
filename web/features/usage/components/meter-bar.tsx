import { cn } from "@/lib/utils"
import { Severity } from "../lib/severity"

export type Tone = "claude" | "neutral" | typeof Severity.Warning | typeof Severity.Critical

const TONE: Record<Tone, { fill: string; track: string }> = {
  claude: { fill: "bg-[var(--claude)]", track: "bg-[var(--claude-track)]" },
  neutral: { fill: "bg-foreground/80", track: "bg-muted" },
  warning: { fill: "bg-[var(--status-warning)]", track: "bg-[var(--status-warning-track)]" },
  critical: { fill: "bg-[var(--status-critical)]", track: "bg-[var(--status-critical-track)]" },
}

/** Pick the tone for a severity: warning/critical win, otherwise the provider accent. */
export const toneFor = (sev: Severity, claude: boolean): Tone => (sev === Severity.Ok ? (claude ? "claude" : "neutral") : sev)

/** Meter: fill carries severity; the track is a lighter step of the same hue. */
export function MeterBar({ value, tone }: { value: number; tone: Tone }) {
  const t = TONE[tone]
  return (
    <div className={cn("h-1.5 flex-1 overflow-hidden rounded-full", t.track)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", t.fill)} style={{ width: `${Math.min(100, Math.max(2, value * 100))}%` }} />
    </div>
  )
}
