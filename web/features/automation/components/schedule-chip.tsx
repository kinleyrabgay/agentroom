"use client"

import { useState } from "react"
import { CalendarClockIcon } from "lucide-react"
import type { ScheduleWhen } from "@shared"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { describeWhen, formatAt } from "../lib/format"
import { WhenPicker } from "./when-picker"

/** "🕘 Tue 21 Oct, 9:00 AM · Change": the time something will run, editable in a popover. */
export function ScheduleChip({ when, onChange, className }: { when: ScheduleWhen; onChange: (w: ScheduleWhen) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) setKey((k) => k + 1)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "tone-brand tone-soft inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            className
          )}
        >
          <CalendarClockIcon className="size-3.5" />
          <span className="text-foreground">{when.type === "once" ? formatAt(when.at) : describeWhen(when)}</span>
          <span className="opacity-70">· Change</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <WhenPicker key={key} value={when} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}
