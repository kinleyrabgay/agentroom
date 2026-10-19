import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { PHASES } from "../constants"

/** Plan → Review → Build → Test → Report → Done. `stopped` freezes the current step (paused/failed/cancelled). */
export function PhaseStepper({
  current,
  stopped,
}: {
  current: number
  stopped: boolean
}) {
  const last = PHASES.length - 1
  return (
    <ol className="flex items-center gap-1.5" aria-label="Goal progress">
      {PHASES.map((p, i) => {
        const done = i < current || (i === last && current === last)
        const active = i === current && current !== last
        return (
          <li key={p.key} className="flex items-center gap-1.5">
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors",
                done &&
                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                active &&
                  !stopped &&
                  "border-primary/40 bg-primary/10 text-foreground",
                active &&
                  stopped &&
                  "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                !done && !active && "text-muted-foreground"
              )}
            >
              {done ? (
                <CheckIcon className="size-3" />
              ) : active ? (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    stopped ? "bg-amber-500" : "animate-pulse bg-primary"
                  )}
                />
              ) : null}
              {p.label}
            </span>
            {i < last && (
              <span
                className={cn(
                  "h-px w-3",
                  i < current ? "bg-emerald-500/50" : "bg-border"
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
