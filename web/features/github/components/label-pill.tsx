import type { GithubLabel } from "@shared"
import { cn } from "@/lib/utils"

/**
 * A GitHub label. Its colour is data, so it shows as a dot in the label's own colour on a quiet pill:
 * consistent with the rest of the UI and readable in both themes.
 */
export function LabelPill({ label, className }: { label: GithubLabel; className?: string }) {
  const color = label.color ? `#${label.color.replace("#", "")}` : undefined
  return (
    <span
      className={cn("inline-flex h-5 max-w-40 items-center gap-1 rounded-full border bg-surface px-1.5 text-xs text-foreground/80", className)}
      title={label.name}
    >
      <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" style={color ? { background: color } : undefined} aria-hidden />
      <span className="truncate">{label.name}</span>
    </span>
  )
}
