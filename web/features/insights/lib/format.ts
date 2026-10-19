/** $1.12, $0.042 for small amounts, $1.2k for large. */
export function usd(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  if (n > 0 && n < 0.1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

/** 45s, 6m, 1h 20m, 2d 3h. */
export function duration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** Elapsed time as 02:14 or 1:02:14. */
export function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export const pct = (x: number) => `${Math.round(x * 100)}%`
