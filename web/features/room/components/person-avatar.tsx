import { cn } from "@/lib/utils"
import { initials, personHue } from "../lib/room-store"

/** Round initials avatar for a person in the team room; the colour is stable per email. */
export function PersonAvatar({
  name,
  email,
  active,
  className,
}: {
  name: string
  email: string
  /** Show a presence dot: true = looking at AgentRoom now, false = connected but away. */
  active?: boolean
  className?: string
}) {
  const hue = personHue(email || name)
  return (
    <span
      className={cn("relative grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold tracking-tight", className)}
      style={{
        background: `color-mix(in oklch, oklch(0.68 0.12 ${hue}) 20%, var(--background))`,
        color: `color-mix(in oklch, oklch(0.5 0.13 ${hue}) 80%, var(--foreground))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, oklch(0.6 0.12 ${hue}) 40%, transparent)`,
      }}
      aria-hidden
    >
      {initials(name)}
      {active !== undefined && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background",
            active ? "tone-success tone-solid" : "bg-muted-foreground/40"
          )}
        />
      )}
    </span>
  )
}
