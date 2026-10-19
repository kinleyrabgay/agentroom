/** "just now", "5m ago", "3h ago", "2d ago", or a date for older times. */
export function timeAgo(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return "just now"
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

export const isToday = (ts: number) => new Date(ts).toDateString() === new Date().toDateString()
