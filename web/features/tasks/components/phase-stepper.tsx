import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { PHASES } from "../constants"

type PhaseKey = (typeof PHASES)[number]["key"]

const last = PHASES.length - 1

/** State of each step: done (success), current (brand, or warning when waiting/stopped), upcoming, skipped. */
function stepState(i: number, current: number, skipped: Partial<Record<PhaseKey, string>>) {
  const skip = skipped[PHASES[i]!.key]
  if (skip) return "skipped" as const
  if (i < current || (i === last && current === last)) return "done" as const
  if (i === current) return "current" as const
  return "upcoming" as const
}

/**
 * Plan → Review → Build → Security → Test → Report → Done. `waiting` marks the current step as
 * waiting on the human (plan review, paused, failed). `skipped` marks steps that don't run for this goal.
 */
export function PhaseStepper({
  current,
  waiting,
  skipped = {},
}: {
  current: number
  waiting: boolean
  /** Step key → short reason, e.g. { security: "off" }. */
  skipped?: Partial<Record<PhaseKey, string>>
}) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2" aria-label="Goal progress">
      {PHASES.map((p, i) => {
        const state = stepState(i, current, skipped)
        const skip = skipped[p.key]
        return (
          <li key={p.key} className="flex items-center">
            <span
              aria-current={state === "current" ? "step" : undefined}
              title={skip ? `${p.label}: ${skip}` : undefined}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
                state === "done" && "tone-success tone-text",
                state === "current" && cn(waiting ? "tone-warning" : "tone-brand", "tone-soft border"),
                state === "upcoming" && "text-muted-foreground",
                state === "skipped" && "text-muted-foreground/70 line-through decoration-muted-foreground/40"
              )}
            >
              {state === "done" ? (
                <CheckIcon className="size-3.5" aria-hidden />
              ) : state === "current" ? (
                <span className="relative flex size-2" aria-hidden>
                  {!waiting && <span className="tone-solid absolute inset-0 animate-ping rounded-full opacity-50" />}
                  <span className="tone-solid relative size-2 rounded-full" />
                </span>
              ) : (
                <span className="size-1.5 rounded-full bg-current opacity-40" aria-hidden />
              )}
              {p.label}
              {skip && <span className="font-normal no-underline">({skip})</span>}
            </span>
            {i < last && (
              <span aria-hidden className={cn("mx-0.5 h-px w-4", i < current ? "bg-success/50" : "bg-border")} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The same progress as a thin segmented bar (goal list rows). */
export function PhaseBar({ current, waiting, className }: { current: number; waiting: boolean; className?: string }) {
  return (
    <div className={cn("flex gap-0.5", className)} role="img" aria-label={`Step ${Math.min(current + 1, last + 1)} of ${last + 1}: ${PHASES[current]?.label}`}>
      {PHASES.slice(0, last).map((p, i) => (
        <span
          key={p.key}
          className={cn(
            "h-1 flex-1 rounded-full",
            i < current || current === last ? "bg-success/70" : i === current ? (waiting ? "bg-warning" : "bg-brand") : "bg-border"
          )}
        />
      ))}
    </div>
  )
}
