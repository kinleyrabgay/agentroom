import type { LucideIcon } from "lucide-react"
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { TONE_CLASS, type Tone } from "./tone"

const DEFAULT_ICON: Record<Tone, LucideIcon> = {
  brand: InfoIcon,
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  danger: OctagonAlertIcon,
  neutral: CircleAlertIcon,
}

/**
 * An inline message next to the thing it is about: what happened and what to do.
 * Title is optional; `action` sits on the right (wraps under on narrow widths).
 */
export function Callout({
  tone = "info",
  icon,
  title,
  action,
  className,
  children,
}: {
  tone?: Tone
  icon?: LucideIcon | null
  title?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  const Icon = icon === null ? null : (icon ?? DEFAULT_ICON[tone])
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn(TONE_CLASS[tone], "tone-soft flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 text-sm", className)}
    >
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-foreground/80 [&_a]:underline [&_a]:underline-offset-2">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
