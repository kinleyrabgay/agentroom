/** 1,284 → "1.3K", 12_900 → "13K", 4_200_000 → "4.20M". */
export const compact = (n: number) =>
  n < 1000 ? String(Math.round(n)) : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K` : `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`

export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`)

/** Fraction (0..1) → "42%". */
export const pct = (n: number) => `${Math.round(n * 100)}%`

export function resetsIn(epochMs: number | undefined, now: number) {
  if (!epochMs) return null
  const mins = Math.max(0, Math.round((epochMs - now) / 60000))
  if (mins < 60) return `resets in ${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 48) return `resets in ${h}h ${mins % 60}m`
  return `resets in ${Math.round(h / 24)}d`
}

export function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

export const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
