"use client"

import { useState } from "react"
import type { ScheduleWhen } from "@shared"
import { cn } from "@/lib/utils"
import { DateTimePicker } from "@/components/kit/date-time-picker"
import { Dropdown } from "@/components/kit/dropdown"
import { FIELD_CLASS } from "@/components/kit/field"
import { quickPicks, repeatOf, toCron, type Repeat } from "../lib/format"

const REPEATS: { label: string; value: Repeat }[] = [
  { label: "Never (once)", value: "never" },
  { label: "Every day", value: "daily" },
  { label: "Weekdays", value: "weekdays" },
  { label: "Every week on this day", value: "weekly" },
  { label: "Custom (cron)", value: "custom" },
]

/**
 * Pick when something runs: a date and time (with quick picks), and whether it repeats.
 * Emits a ScheduleWhen; a repeat uses the picked time of day (and weekday for weekly).
 */
export function WhenPicker({ value, onChange, className }: { value: ScheduleWhen; onChange: (w: ScheduleWhen) => void; className?: string }) {
  const [repeat, setRepeat] = useState<Repeat>(repeatOf(value))
  const [at, setAt] = useState<Date>(() => (value.type === "once" ? new Date(value.at) : new Date()))
  const [custom, setCustom] = useState(value.type === "cron" && repeatOf(value) === "custom" ? value.cron : "0 9 * * 1-5")

  const emit = (r: Repeat, d: Date, c = custom) => {
    if (r === "never") onChange({ type: "once", at: d.toISOString() })
    else if (r === "custom") onChange({ type: "cron", cron: c.trim(), label: `Custom: ${c.trim()}` })
    else onChange({ type: "cron", ...toCron(r, d) })
  }

  return (
    <div className={cn("space-y-2.5", className)}>
      {repeat !== "custom" && (
        <>
          <DateTimePicker
            value={at}
            onChange={(d) => {
              setAt(d)
              emit(repeat, d)
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            {quickPicks().map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  setAt(q.at)
                  emit(repeat, q.at)
                }}
                className="h-7 rounded-full border bg-surface px-3 text-xs text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {q.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted-foreground">Repeat</span>
        <Dropdown<Repeat>
          datas={REPEATS}
          selectedValue={repeat}
          showSearch={false}
          onSelect={(v) => {
            const r = v as Repeat
            setRepeat(r)
            emit(r, at)
          }}
        />
      </div>
      {repeat === "custom" && (
        <div className="space-y-1">
          <input
            aria-label="Cron expression"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value)
              emit("custom", at, e.target.value)
            }}
            className={cn(FIELD_CLASS, "font-mono text-xs")}
            placeholder="minute hour day month weekday, e.g. 30 8 * * 1-5"
          />
          <p className="text-xs text-muted-foreground">Local time. Example: <span className="font-mono">30 8 * * 1-5</span> = weekdays at 8:30.</p>
        </div>
      )}
    </div>
  )
}
