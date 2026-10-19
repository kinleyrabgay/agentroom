import { cn } from "@/lib/utils"

/** The AgentRoom glyph: a friendly bot head with a bent antenna. Drawn in currentColor (24 × 24). */
export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeLinecap="round">
      <rect x="4.2" y="8.6" width="15.6" height="11" rx="3.6" strokeWidth="2" />
      <path d="M12 8.6V5.1h2.6" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9.6 12.9v2.4M14.4 12.9v2.4" strokeWidth="2.2" />
      <path d="M2.4 12.8v2.6M21.6 12.8v2.6" strokeWidth="2" />
    </svg>
  )
}

/** The app mark: the teal bot in a round, softly bordered badge. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-full border bg-surface text-brand shadow-xs", className)} aria-hidden>
      <LogoGlyph className="size-[66%]" />
    </span>
  )
}
