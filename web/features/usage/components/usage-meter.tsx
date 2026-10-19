"use client"

import { useMemo } from "react"
import { ProviderId, totalTokens } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { isClaude } from "../constants"
import { compact, titleCase, usd } from "../lib/format"
import { limitSeverity, percentSeverity, worstLimit } from "../lib/severity"
import { MiniRing } from "./mini-ring"
import { ProviderMark } from "./provider-mark"
import { UsageCard } from "./usage-card"

/** Top-bar pill: tokens + cost, with a ring for the highest plan window. Hover for details. */
export function UsageMeter() {
  const usage = useAppStore((s) => s.usage)
  const account = useAppStore((s) => s.account)
  const provider = useAppStore((s) => s.info?.provider ?? ProviderId.Claude)
  const claude = isClaude(provider)
  const providerName = claude ? "Claude" : titleCase(provider)

  const ring = useMemo(() => {
    const top = account?.windows.slice().sort((a, b) => b.percent - a.percent)[0]
    if (top) return { value: top.percent / 100, severity: percentSeverity(top.percent) }
    const worst = worstLimit(Object.values(usage.limits))
    return worst?.utilization !== undefined ? { value: worst.utilization, severity: limitSeverity(worst) } : null
  }, [account, usage.limits])

  return (
    <HoverCard openDelay={120} closeDelay={150}>
      <HoverCardTrigger asChild>
        <button
          aria-label="Token usage"
          className={cn(
            "usage-viz group flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs transition-colors",
            claude ? "border-[var(--claude-ring)] bg-[var(--claude-wash)] hover:bg-[var(--claude-wash-strong)]" : "bg-muted/40 hover:bg-muted"
          )}
        >
          <ProviderMark provider={provider} className="size-3.5" />
          <span className="font-medium tabular-nums">{compact(totalTokens(usage.totals))}</span>
          <span className="text-muted-foreground">tokens</span>
          <span className="h-3 w-px bg-border" />
          <span className="font-mono text-muted-foreground tabular-nums">{usd(usage.totals.costUsd)}</span>
          {ring && <MiniRing value={ring.value} severity={ring.severity} claude={claude} />}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" sideOffset={8} className="usage-viz w-[380px] overflow-hidden p-0">
        <UsageCard usage={usage} account={account} provider={provider} providerName={providerName} claude={claude} />
      </HoverCardContent>
    </HoverCard>
  )
}
