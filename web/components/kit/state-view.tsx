import type { ComponentType } from "react"
import { Loader2Icon, OctagonAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** A designed empty state: what will appear here and how to get the first one. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ComponentType<{ className?: string }>
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16", className)}>
      {Icon && (
        <span className={cn("grid place-items-center rounded-2xl border bg-surface text-muted-foreground shadow-xs", compact ? "size-10" : "size-12")}>
          <Icon className={compact ? "size-4" : "size-5"} aria-hidden />
        </span>
      )}
      <div className="max-w-sm space-y-1">
        <p className={cn("font-medium text-balance", compact ? "text-sm" : "text-base")}>{title}</p>
        {description && <p className="text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/** Something failed to load: the message and a way to try again. */
export function ErrorState({ title = "Couldn't load this", error, onRetry, className }: { title?: string; error: string; onRetry?: () => void; className?: string }) {
  return (
    <EmptyState
      icon={OctagonAlertIcon}
      title={title}
      description={<span className="font-mono text-xs break-words">{error}</span>}
      action={onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
      className={className}
    />
  )
}

/** Centered spinner with a label, for first loads that have no skeleton. */
export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground", className)}>
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}
