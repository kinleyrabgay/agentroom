"use client"

import { useEffect, useState } from "react"
import { totalTokens, type AccountUsage, type UsageSummary } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { Separator } from "@/components/ui/separator"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { CLOCK_TICK_MS, CRITICAL_AT, WARNING_AT, WINDOW_LABEL } from "../constants"
import { ago, compact, pct, titleCase, usd } from "../lib/format"
import { Severity } from "../lib/severity"
import { LimitMeter } from "./limit-meter"
import { MeterBar, toneFor } from "./meter-bar"
import { PlanMeter } from "./plan-meter"
import { ProviderMark } from "./provider-mark"
import { TokenMix } from "./token-mix"

const windowOrder = (w: string) => {
  const i = Object.keys(WINDOW_LABEL).indexOf(w)
  return i < 0 ? 99 : i
}

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Hover card: account plan (all Claude apps) on top, AgentRoom's own spend below. */
export function UsageCard({ usage, account, provider, providerName, claude }: {
  usage: UsageSummary
  account: AccountUsage | null
  provider: string
  providerName: string
  claude: boolean
}) {
  const now = useNow()
  const tokens = totalTokens(usage.totals)
  const prompt = usage.totals.input + usage.totals.cacheRead + usage.totals.cacheWrite
  const cacheHit = prompt ? usage.totals.cacheRead / prompt : 0

  return (
    <div>
      <header className={cn("px-4 pt-4 pb-3", claude ? "bg-gradient-to-br from-[var(--claude-wash-strong)] to-transparent" : "bg-muted/40")}>
        <div className="flex items-center gap-2.5">
          <span className={cn("grid size-8 place-items-center rounded-xl", claude ? "bg-[var(--claude)] text-white shadow-sm" : "bg-foreground text-background")}>
            <ProviderMark provider={provider} className="size-4" mono />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-medium">{providerName} usage</div>
            <div className="text-xs text-muted-foreground">
              {account?.plan ? `${titleCase(account.plan)} plan` : claude ? "Claude Code login" : "API"}
              {account?.organization ? ` · ${account.organization}` : ""}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">
              AgentRoom bots · since {new Date(usage.since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
            <div className="text-4xl font-semibold tracking-tight tabular-nums">{compact(tokens)}</div>
          </div>
          <div className="flex gap-4 pb-1 text-right">
            <Stat label="Cost" value={usd(usage.totals.costUsd)} />
            <Stat label="Runs" value={String(usage.totals.runs)} />
            <Stat label="Cache hit" value={prompt ? pct(cacheHit) : "—"} />
          </div>
        </div>
      </header>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto px-4 py-4">
        <PlanSection usage={usage} account={account} claude={claude} now={now} />
        <Section title="Token mix">
          {tokens ? (
            <TokenMix counts={usage.totals} />
          ) : (
            <p className="text-xs text-muted-foreground">No usage yet. Token counts appear here after a bot finishes a run.</p>
          )}
        </Section>
        <BotBreakdown usage={usage} claude={claude} />
        <ModelBreakdown usage={usage} />
      </div>

      <Separator />
      <p className="px-4 py-2.5 text-[11px] text-muted-foreground">
        Plan usage covers every Claude app on your account. Token counts and costs cover only AgentRoom&apos;s bots; costs are estimates.
      </p>
    </div>
  )
}

function PlanSection({ usage, account, claude, now }: { usage: UsageSummary; account: AccountUsage | null; claude: boolean; now: number }) {
  const limits = Object.values(usage.limits).sort((a, b) => windowOrder(a.window) - windowOrder(b.window))

  if (claude && account?.available && account.windows.length) {
    return (
      <Section title="Your plan · all Claude apps" aside={`updated ${ago(account.fetchedAt, now)}`}>
        <div className="space-y-3">
          {account.windows.map((w) => (
            <PlanMeter key={w.key} window={w} now={now} />
          ))}
          {account.extraUsage?.percent != null && (
            <PlanMeter window={{ key: "extra", label: "Extra usage", percent: account.extraUsage.percent }} now={now} />
          )}
        </div>
      </Section>
    )
  }
  if (claude && account && !account.available) {
    return (
      <Section title="Your plan">
        <p className="text-xs text-muted-foreground">Signed in with an API key or cloud provider, so there are no plan limits. Spend is shown below.</p>
      </Section>
    )
  }
  if (!claude && !limits.length) return null
  return (
    <Section title={claude ? "Plan limits" : "Rate limits"}>
      {limits.length ? (
        <div className="space-y-3">
          {limits.map((l) => (
            <LimitMeter key={l.window} limit={l} now={now} claude={claude} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Checking your plan… Limits appear once Claude Code reports them.</p>
      )}
    </Section>
  )
}

function BotBreakdown({ usage, claude }: { usage: UsageSummary; claude: boolean }) {
  const bots = useAppStore((s) => s.bots)
  const rows = Object.entries(usage.byBot)
    .map(([id, u]) => ({ id, u, bot: bots.find((b) => b.id === id) }))
    .sort((a, b) => totalTokens(b.u) - totalTokens(a.u))
  if (!rows.length) return null

  return (
    <Section title="By bot">
      <ul className="space-y-2.5">
        {rows.map(({ id, u, bot }) => {
          const fill = u.contextUsed && u.contextWindow ? u.contextUsed / u.contextWindow : undefined
          const sev = fill === undefined ? Severity.Ok : fill > CRITICAL_AT ? Severity.Critical : fill > WARNING_AT ? Severity.Warning : Severity.Ok
          return (
            <li key={id} className="flex items-center gap-2.5">
              {bot ? <BotAvatar bot={bot} className="size-6 rounded-md text-xs" /> : <span className="size-6 rounded-md bg-muted" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{bot?.name ?? id}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {compact(totalTokens(u))} · {usd(u.costUsd)}
                  </span>
                </div>
                {fill !== undefined && (
                  <div className="mt-1 flex items-center gap-2" title={`${compact(u.contextUsed!)} of ${compact(u.contextWindow!)} context tokens on the last turn`}>
                    <MeterBar value={fill} tone={toneFor(sev, claude)} />
                    <span className="w-16 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">ctx {pct(fill)}</span>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function ModelBreakdown({ usage }: { usage: UsageSummary }) {
  const models = Object.entries(usage.byModel).sort((a, b) => totalTokens(b[1]) - totalTokens(a[1]))
  if (!models.length) return null
  return (
    <Section title="By model">
      <ul className="space-y-1.5 text-xs">
        {models.map(([model, u]) => (
          <li key={model} className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[11px]">{model}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {compact(totalTokens(u))} · {usd(u.costUsd)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
        {aside && <span className="text-[10px] text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}
