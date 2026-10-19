"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Insights } from "@shared"
import { usd } from "../lib/format"

const HEIGHT = 200
const PAD = { top: 14, right: 12, bottom: 26, left: 44 }
const GAP = 2
const RADIUS = 4

/** 1, 2, 2.5 or 5 × a power of ten: tick steps a person can read. */
function niceStep(max: number, ticks = 4) {
  const raw = max / ticks
  const pow = 10 ** Math.floor(Math.log10(raw || 1))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
}

/** A bar with only its top corners rounded, anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })

/** Spend per day as bars on one axis, with the daily cap as a dashed line. Hover a day for its total. */
export function SpendChart({ data, cap }: { data: Insights["dailySpend"]; cap?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { step, top } = useMemo(() => {
    const max = Math.max(cap ?? 0, ...data.map((d) => d.usd), 0.01)
    const s = niceStep(max)
    return { step: s, top: Math.ceil(max / s) * s }
  }, [data, cap])

  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const slot = plotW / Math.max(1, data.length)
  const barW = Math.max(1, slot - GAP)
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  // A few date labels: first, middle, last (more on wide charts).
  const every = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(plotW / 90))))
  const h = hover !== null ? data[hover] : undefined

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Spend per day over ${data.length} days, total ${usd(data.reduce((t, d) => t + d.usd, 0))}`}
        onMouseLeave={() => setHover(null)}
        className="block text-muted-foreground"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-xs tabular-nums">
              {usd(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.left + i * slot + GAP / 2
          const bh = d.usd > 0 ? Math.max(2, (d.usd / top) * plotH) : 0
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              {/* Hit area larger than the mark. */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {bh > 0 && (
                <path
                  d={barPath(x, PAD.top + plotH - bh, barW, bh)}
                  fill="var(--chart-1)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {i % every === 0 && (
                <text x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-xs">
                  {shortDate(d.date)}
                </text>
              )}
            </g>
          )
        })}
        {cap !== undefined && (
          <g>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(cap)} y2={y(cap)} stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="4 4" />
            <text x={width - PAD.right} y={y(cap) - 6} textAnchor="end" className="fill-foreground text-xs">
              Daily cap {usd(cap)}
            </text>
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-1 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: Math.min(width - 130, Math.max(0, PAD.left + hover * slot - 40)) }}
        >
          <p className="text-muted-foreground">{shortDate(h.date)}</p>
          <p className="font-medium tabular-nums">{usd(h.usd)}</p>
        </div>
      )}
    </div>
  )
}
