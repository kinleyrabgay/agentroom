"use client"

import { useEffect, useState } from "react"
import { ArrowRightIcon, SunriseIcon, XIcon } from "lucide-react"
import type { Brief } from "@shared"
import { automationApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ToneDot } from "@/components/kit/badge"

/** Only a real brief (an older server may answer with something else, e.g. `{}`). */
function asBrief(v: unknown): Brief | null {
  const b = v as Partial<Brief> | null
  return b && typeof b === "object" && typeof b.since === "string" && typeof b.spentUsd === "number" && typeof b.goalsDone === "number" ? (b as Brief) : null
}

const hours = (from: string, to: string) => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 3_600_000))

/** "While you were away": shown at the top of the Inbox after 2+ hours away, when something happened. */
export function AwayBrief() {
  const [brief, setBrief] = useState<Brief | null>(null)
  const goals = useAppStore((s) => s.goals)
  useEffect(() => {
    automationApi.brief().then((b) => setBrief(asBrief(b))).catch(() => setBrief(null))
  }, [goals])
  if (!brief) return null

  const dismiss = () => {
    setBrief(null)
    automationApi.dismissBrief().catch(() => {})
  }
  const since = new Date(brief.since).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
  const stats = [
    { n: brief.goalsDone, label: brief.goalsDone === 1 ? "goal finished" : "goals finished" },
    { n: brief.prsOpened, label: brief.prsOpened === 1 ? "PR ready to review" : "PRs ready to review" },
    { n: brief.waiting, label: brief.waiting === 1 ? "needs you" : "need you" },
    { n: `$${brief.spentUsd.toFixed(2)}`, label: brief.dailyCapUsd ? `spent of $${brief.dailyCapUsd}` : "spent" },
  ]

  return (
    <section aria-label="While you were away" className="space-y-4 rounded-2xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-sunken text-brand">
          <SunriseIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">While you were away</h2>
          <p className="text-xs text-muted-foreground">
            Since {since} · {hours(brief.since, brief.until)} hours{brief.automationRuns ? ` · ${brief.automationRuns} automation ${brief.automationRuns === 1 ? "run" : "runs"}` : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label="Dismiss">
          <XIcon />
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="sr-only">{s.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{s.n}</dd>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </dl>
      {brief.items.length > 0 && (
        <ul className="divide-y rounded-xl border bg-sunken/50">
          {brief.items.map((it, i) => (
            <li key={i}>
              <a href={it.href} className={cn("flex items-center gap-3 px-3 py-2.5 text-sm outline-none hover:bg-accent/40 focus-visible:bg-accent/40")}>
                <ToneDot tone={it.tone} />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
