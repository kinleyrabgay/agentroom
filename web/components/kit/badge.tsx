import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { TONE_CLASS, type Tone } from "./tone"

/**
 * A small status pill: soft tone fill, readable ink, optional dot or icon.
 * `size="sm"` for dense rows (20px), default 22px.
 */
export function ToneBadge({
  tone = "neutral",
  icon: Icon,
  dot,
  pulse,
  size = "default",
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & {
  tone?: Tone
  icon?: LucideIcon
  dot?: boolean
  pulse?: boolean
  size?: "sm" | "default"
}) {
  return (
    <span
      className={cn(
        TONE_CLASS[tone],
        "tone-soft inline-flex w-fit shrink-0 items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-xs" : "h-[22px] px-2 text-xs",
        className
      )}
      {...props}
    >
      {dot && <ToneDot tone={tone} pulse={pulse} />}
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  )
}

/** A status dot in a tone. `pulse` for live/working states. */
export function ToneDot({ tone = "neutral", pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn(TONE_CLASS[tone], "relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {pulse && <span className="tone-solid absolute inset-0 animate-ping rounded-full opacity-50" />}
      <span className="tone-solid relative inline-flex size-2 rounded-full" />
    </span>
  )
}
