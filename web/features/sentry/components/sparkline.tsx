import { cn } from "@/lib/utils"

/** Events per hour over the last 24 h as tiny bars (oldest left). Each bar has a native tooltip. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values)
  const n = values.length || 24
  const w = 3
  const gap = 1
  const h = 24
  return (
    <svg
      viewBox={`0 0 ${n * (w + gap) - gap} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-6 w-24 text-muted-foreground/70", className)}
      role="img"
      aria-label={`${values.reduce((a, b) => a + b, 0)} events in the last 24 hours`}
    >
      {values.map((v, i) => {
        const bh = v ? Math.max(2, (v / max) * h) : 1
        const hoursAgo = n - 1 - i
        return (
          <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={0.5} className={v ? "fill-current" : "fill-current opacity-30"}>
            <title>
              {v} {v === 1 ? "event" : "events"} · {hoursAgo === 0 ? "this hour" : `${hoursAgo}h ago`}
            </title>
          </rect>
        )
      })}
    </svg>
  )
}
