import type { AutomationAction, Bot, ScheduleWhen } from "@shared"

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]

/** "Tue 21 Oct, 9:00 AM". */
export function formatAt(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

/** "Tomorrow 9:00 AM", "Today 10:00 PM", or "Tue 21 Oct, 9:00 AM". */
export function formatRelative(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86_400_000)
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  if (diff === 0) return `Today ${time}`
  if (diff === 1) return `Tomorrow ${time}`
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString(undefined, { weekday: "long" })} ${time}`
  return formatAt(iso)
}

export function describeWhen(w: ScheduleWhen): string {
  return w.type === "once" ? `Once · ${formatAt(w.at)}` : w.label
}

export function describeAction(a: AutomationAction, bots: Bot[]): { who: Bot | undefined; text: string } {
  const lead = bots.find((b) => !b.reportsTo)
  if (a.type === "goal") return { who: lead, text: `Goal: ${a.title || a.brief}` }
  if (a.type === "message") return { who: bots.find((b) => b.id === a.botId), text: a.text }
  return { who: bots.find((b) => b.id === a.botId) ?? lead, text: `Hand off ${a.ids.length} ${a.source === "github" ? "GitHub" : "Sentry"} ${a.ids.length === 1 ? "item" : "items"}` }
}

export type Repeat = "never" | "daily" | "weekdays" | "weekly" | "custom"

/** A repeat choice at a given time → cron + label (local time). */
export function toCron(repeat: Exclude<Repeat, "never" | "custom">, at: Date): { cron: string; label: string } {
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  const m = at.getMinutes()
  const h = at.getHours()
  if (repeat === "daily") return { cron: `${m} ${h} * * *`, label: `Every day at ${time}` }
  if (repeat === "weekdays") return { cron: `${m} ${h} * * 1-5`, label: `Weekdays at ${time}` }
  return { cron: `${m} ${h} * * ${at.getDay()}`, label: `${WEEKDAYS[at.getDay()]} at ${time}` }
}

/** Best guess of the repeat choice for an existing cron (for editing). */
export function repeatOf(when: ScheduleWhen): Repeat {
  if (when.type === "once") return "never"
  const parts = when.cron.trim().split(/\s+/)
  if (parts.length !== 5 || parts[2] !== "*" || parts[3] !== "*") return "custom"
  if (parts[4] === "*") return "daily"
  if (parts[4] === "1-5") return "weekdays"
  if (/^[0-6]$/.test(parts[4]!)) return "weekly"
  return "custom"
}

/** Quick picks for "when". */
export function quickPicks(now = new Date()): { label: string; at: Date }[] {
  const at = (days: number, h: number, m = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(h, m, 0, 0)
    return d
  }
  const inHour = new Date(now.getTime() + 60 * 60 * 1000)
  inHour.setSeconds(0, 0)
  const tonight = at(now.getHours() >= 22 ? 1 : 0, 22)
  const monday = at(((8 - now.getDay()) % 7) || 7, 9)
  return [
    { label: "In 1 hour", at: inHour },
    { label: "Tonight 10 PM", at: tonight },
    { label: "Tomorrow 9 AM", at: at(1, 9) },
    { label: "Monday 9 AM", at: monday },
  ]
}
