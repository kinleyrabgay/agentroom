"use client"

import { useMemo } from "react"
import { ProviderId, totalTokens } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { isClaude } from "../constants"
import { compact, titleCase, usd } from "../lib/format"
import { limitSeverity, percentSeverity, worstLimit } from "../lib/severity"
import { MiniRing } from "./mini-ring"
import { ProviderMark } from "./provider-mark"
import { UsageCard } from "./usage-card"
import { budgetTone, useBudget } from "@/features/tasks/hooks/use-budget"
import { TONE_CLASS } from "@/components/kit/tone"

/** Top-bar pill: tokens + cost, with a ring for the highest plan window. Click (or Enter) for details. */
export function UsageMeter() {
  const usage = useAppStore((s) => s.usage)
  const account = useAppStore((s) => s.account)
  const provider = useAppStore((s) => s.info?.provider ?? ProviderId.Claude)
  const claude = isClaude(provider)
  const providerName = claude ? "Claude" : titleCase(provider)
  const budget = useBudget()

  const ring = useMemo(() => {
    const top = account?.windows
      .slice()
      .sort((a, b) => b.percent - a.percent)[0]
    if (top)
      return {
        value: top.percent / 100,
        severity: percentSeverity(top.percent),
      }
    const worst = worstLimit(Object.values(usage.limits))
    return worst?.utilization !== undefined
      ? { value: worst.utilization, severity: limitSeverity(worst) }
      : null
  }, [account, usage.limits])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Token usage and plan limits"
          className={cn(
            "usage-viz group flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            claude
              ? "border-(--claude-ring) bg-(--claude-wash) hover:bg-(--claude-wash-strong)"
              : "bg-surface hover:bg-accent"
          )}
        >
          <ProviderMark provider={provider} className="size-3.5" />
          <span className="font-medium tabular-nums">
            {compact(totalTokens(usage.totals))}
          </span>
          <span className="text-muted-foreground">tokens</span>
          <span className="h-3 w-px bg-border" />
          {budget?.perDayUsd ? (
            <DayBudget spent={budget.spentToday} cap={budget.perDayUsd} warnAt={budget.warnAt} />
          ) : (
            <span className="font-mono text-muted-foreground tabular-nums">
              {usd(usage.totals.costUsd)}
            </span>
          )}
          {ring && (
            <MiniRing
              value={ring.value}
              severity={ring.severity}
              claude={claude}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="usage-viz w-95 overflow-hidden p-0"
      >
        <UsageCard
          usage={usage}
          account={account}
          provider={provider}
          providerName={providerName}
          claude={claude}
        />
      </PopoverContent>
    </Popover>
  )
}

/** "Today $3.20 / $10" with a thin meter, toned at the warning line and the cap. */
function DayBudget({ spent, cap, warnAt }: { spent: number; cap: number; warnAt: number }) {
  const tone = budgetTone(spent, cap, warnAt)
  return (
    <span className="flex items-center gap-1.5" title="Spent today against the daily budget (Settings → Budgets)">
      <span className={cn("tabular-nums", tone === "neutral" ? "text-muted-foreground" : cn(TONE_CLASS[tone], "tone-text font-medium"))}>
        Today {usd(spent)} / {usd(cap)}
      </span>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className={cn("block h-full rounded-full", tone === "neutral" ? "bg-brand" : cn(TONE_CLASS[tone], "tone-solid"))}
          style={{ width: `${Math.min(100, (spent / cap) * 100)}%` }}
        />
      </span>
    </span>
  )
}
