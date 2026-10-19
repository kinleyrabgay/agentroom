"use client"

import { useCallback, useEffect, useState } from "react"
import { ChartNoAxesColumnIcon, TableIcon } from "lucide-react"
import type { Insights, InsightsPeriod } from "@shared"
import { cn } from "@/lib/utils"
import { insightsApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { PageActions } from "@/components/layout/page-actions"
import { Segmented } from "@/components/kit/segmented"
import { EmptyState, ErrorState } from "@/components/kit/state-view"
import { duration, pct, usd } from "../lib/format"
import { SpendChart } from "./spend-chart"

const PERIOD_KEY = "agentroom.insights.period"
const PERIODS: InsightsPeriod[] = ["7d", "30d", "90d"]

function savedPeriod(): InsightsPeriod {
  try {
    const p = localStorage.getItem(PERIOD_KEY) as InsightsPeriod | null
    if (p && PERIODS.includes(p)) return p
  } catch {
    // storage blocked
  }
  return "30d"
}

/** How the team is doing over a period: results, spend, per-bot success and why runs fail. */
export function InsightsPage() {
  const [period, setPeriod] = useState<InsightsPeriod>(savedPeriod)
  const [data, setData] = useState<Insights | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    (p: InsightsPeriod) =>
      insightsApi
        .get(p)
        .then((d) => {
          setData(d)
          setError(null)
        })
        .catch((e: Error) => setError(e.message)),
    []
  )

  useEffect(() => {
    void load(period)
  }, [period, load])

  const choose = (p: InsightsPeriod) => {
    setPeriod(p)
    try {
      localStorage.setItem(PERIOD_KEY, p)
    } catch {
      // storage blocked
    }
  }

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <PageActions>
        <Segmented<InsightsPeriod>
          aria-label="Period"
          size="sm"
          value={period}
          onChange={choose}
          options={PERIODS.map((p) => ({ value: p, label: p }))}
        />
      </PageActions>
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-5 pb-16">
        {error && !data ? (
          <ErrorState error={error} onRetry={() => void load(period)} />
        ) : !data ? (
          <LoadingSkeleton />
        ) : data.perBot.length === 0 && data.goalsFinished === 0 && data.goalsFailed === 0 ? (
          <EmptyState
            icon={ChartNoAxesColumnIcon}
            title="Nothing to show for this period yet"
            description="Insights come from finished bot runs. Give the team a goal and check back here to see results, spend and where runs get stuck."
          />
        ) : (
          <Loaded data={data} />
        )}
      </div>
    </div>
  )
}

function Loaded({ data }: { data: Insights }) {
  const merged = data.prsMerged
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
        <Kpi
          label="Goals finished"
          value={String(data.goalsFinished)}
          note={
            data.finishedWithoutHelpPct !== null
              ? `${data.finishedWithoutHelpPct}% without help${data.goalsFailed ? ` · ${data.goalsFailed} failed` : ""}`
              : data.goalsFailed
                ? `${data.goalsFailed} failed`
                : "None in this period"
          }
        />
        <Kpi label="Spend" value={usd(data.spendUsd)} note={data.spendPerGoal !== null ? `${usd(data.spendPerGoal)} per goal` : "No goal runs"} />
        <Kpi
          label="Approval wait"
          value={data.approvalWaitMedianMs !== null ? duration(data.approvalWaitMedianMs) : "–"}
          note={data.approvalWaitMedianMs !== null ? "median time to answer" : "No approvals asked"}
        />
        <Kpi
          label="PRs opened"
          value={String(data.prsOpened ?? 0)}
          note={merged !== undefined ? `${merged} merged` : "From the audit log"}
        />
      </div>

      <Section title="Spend per day" aside={data.dailyCapUsd ? `Daily cap ${usd(data.dailyCapUsd)}` : undefined}>
        <SpendBlock data={data} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Per bot">
          <PerBot rows={data.perBot} />
        </Section>
        <div className="space-y-5">
          <Section title="Why runs fail">
            {data.failureReasons.length ? (
              <ul className="divide-y">
                {data.failureReasons.map((r) => (
                  <li key={r.reason} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span>{r.reason}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{r.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No failed runs in this period.</p>
            )}
          </Section>
          <Section title="Skills">
            {data.skills.length ? (
              <ul className="divide-y">
                {data.skills.map((s) => (
                  <li key={s.skill} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.skill}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{s.runs} runs</span>
                    <span className="w-10 text-right tabular-nums">{pct(s.successRate)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No skills used in this period.</p>
            )}
          </Section>
        </div>
      </div>
    </>
  )
}

function SpendBlock({ data }: { data: Insights }) {
  const [table, setTable] = useState(false)
  const highest = data.dailySpend.reduce((m, d) => (d.usd > m.usd ? d : m), { date: "", usd: 0 })
  return (
    <div className="space-y-2 px-4 pt-3 pb-4">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {usd(data.spendUsd)} total{highest.usd > 0 ? ` · highest day ${usd(highest.usd)}` : ""}
        </span>
        <Button variant="ghost" size="xs" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? <ChartNoAxesColumnIcon data-icon="inline-start" /> : <TableIcon data-icon="inline-start" />}
          {table ? "Show chart" : "Show as table"}
        </Button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-sunken text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Day</th>
                <th className="px-3 py-1.5 text-right font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              {[...data.dailySpend].reverse().map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="px-3 py-1.5">{d.date}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(d.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <SpendChart data={data.dailySpend} cap={data.dailyCapUsd} />
      )}
    </div>
  )
}

function PerBot({ rows }: { rows: Insights["perBot"] }) {
  const bots = useAppStore((s) => s.bots)
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No bot runs in this period.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 text-left font-medium">Bot</th>
            <th className="px-2 py-2 text-right font-medium">Runs</th>
            <th className="px-2 py-2 text-left font-medium">Success</th>
            <th className="px-2 py-2 text-right font-medium">Cost</th>
            <th className="px-4 py-2 text-right font-medium">Avg time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const bot = bots.find((b) => b.id === r.botId)
            return (
              <tr key={r.botId} className="border-b last:border-0">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    {bot ? <BotAvatar bot={bot} className="size-6 rounded-md text-xs" /> : null}
                    <span className="truncate">{bot?.name ?? r.botId}</span>
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{r.runs}</td>
                <td className="px-2 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken" aria-hidden>
                      <span
                        className={cn("block h-full rounded-full", r.successRate >= 0.8 ? "bg-success" : r.successRate >= 0.5 ? "bg-warning" : "bg-danger")}
                        style={{ width: `${Math.round(r.successRate * 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{pct(r.successRate)}</span>
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{usd(r.costUsd)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{duration(r.avgDurationMs)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading insights">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  )
}
