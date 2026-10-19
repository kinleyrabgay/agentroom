"use client"

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  /** Accessible name when the label is an icon. */
  title?: string
}

/** A single-choice switch (period, view mode, tabs that aren't routes). Keyboard: arrows move, Space selects. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "default",
  className,
  "aria-label": ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  size?: "sm" | "default"
  className?: string
  "aria-label": string
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-0.5 rounded-full border bg-sunken p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleGroupPrimitive.Item
          key={o.value}
          value={o.value}
          title={o.title}
          aria-label={o.title}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
            "data-[state=on]:bg-surface data-[state=on]:text-foreground data-[state=on]:shadow-xs",
            size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[13px]"
          )}
        >
          {o.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
}
