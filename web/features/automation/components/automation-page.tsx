"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarClockIcon, ClockIcon, HistoryIcon, MonitorIcon, MoreHorizontalIcon, PlayIcon, PlusIcon, ZapIcon } from "lucide-react"
import { firstName, ScopeBadge } from "./scope-field"
import { toast } from "sonner"
import type { AutomationOutcome, AutomationRun, ScheduleView, TriggerView } from "@shared"
import { automationApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { ToneBadge } from "@/components/kit/badge"
import { EmptyState, LoadingState } from "@/components/kit/state-view"
import type { Tone } from "@/components/kit/tone"
import { PageActions } from "@/components/layout/page-actions"
import { describeAction, describeWhen, formatRelative } from "../lib/format"
import { openSchedule, openTrigger } from "../lib/ui-store"
import { RunnerCallout } from "./runner-callout"

const OUTCOME: Record<AutomationOutcome, { label: string; tone: Tone }> = {
  started: { label: "Started", tone: "success" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
}

type Tab = "schedules" | "triggers" | "history"

/** Schedules, triggers and their history: everything that runs the team without you. */
export function AutomationPage() {
  const snap = useAppStore((s) => s.automation)
  const [tab, setTab] = useState<Tab>("schedules")

  // Opening the page counts as seeing failed runs (clears the sidebar badge).
  useEffect(() => {
    automationApi.seen().catch(() => {})
  }, [])

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <PageActions>
        {snap?.next && (
          <ToneBadge tone="brand" icon={ClockIcon} className="hidden h-8 px-3 text-[13px] 2xl:inline-flex">
            Next: {formatRelative(snap.next.at)}
          </ToneBadge>
        )}
        <Button size="sm" variant="outline" onClick={() => openTrigger()}>
          <ZapIcon data-icon="inline-start" /> New trigger
        </Button>
        <Button size="sm" onClick={() => openSchedule()}>
          <PlusIcon data-icon="inline-start" /> New schedule
        </Button>
      </PageActions>
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-5 pb-24">
        <RunnerCallout />
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList variant="line">
            <TabsTrigger value="schedules">Schedules {snap ? <span className="text-muted-foreground tabular-nums">{snap.schedules.length}</span> : null}</TabsTrigger>
            <TabsTrigger value="triggers">Triggers {snap ? <span className="text-muted-foreground tabular-nums">{snap.triggers.length}</span> : null}</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="schedules" className="pt-4">
            {!snap ? <LoadingState /> : <Schedules list={snap.schedules} />}
          </TabsContent>
          <TabsContent value="triggers" className="pt-4">
            {!snap ? <LoadingState /> : <Triggers list={snap.triggers} />}
          </TabsContent>
          <TabsContent value="history" className="pt-4">
            <History />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function Schedules({ list }: { list: ScheduleView[] }) {
  const bots = useAppStore((s) => s.bots)
  if (!list.length)
    return (
      <EmptyState
        icon={CalendarClockIcon}
        title="Nothing scheduled"
        description="Type a time in the composer (“tomorrow at 9”), use Later when handing off, or create a schedule here."
        action={<Button size="sm" onClick={() => openSchedule()}><PlusIcon data-icon="inline-start" /> New schedule</Button>}
      />
    )
  const run = (p: Promise<unknown>, ok: string) => p.then(() => toast.success(ok)).catch((e) => toast.error((e as Error).message))
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">What</th>
            <th className="px-3 py-2.5 font-medium">When</th>
            <th className="px-3 py-2.5 font-medium">Who</th>
            <th className="px-3 py-2.5 font-medium">Next run</th>
            <th className="px-3 py-2.5 font-medium">Last</th>
            <th className="w-24 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {list.map((s) => {
            const { who, text } = describeAction(s.action, bots)
            return (
              <tr key={s.id} className="border-b last:border-0 hover:bg-accent/30">
                <td className="max-w-80 px-4 py-3">
                  <button className="block w-full truncate text-left font-medium hover:underline" onClick={() => openSchedule({ id: s.id, name: s.name, when: s.when, action: s.action, scope: s.scope, owner: s.owner })}>
                    {s.name}
                  </button>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-xs text-muted-foreground">{text}</span>
                    <ScopeBadge scope={s.scope} owner={s.owner} runsHere={s.runsHere} />
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{describeWhen(s.when)}</td>
                <td className="px-3 py-3">
                  {who ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <BotAvatar bot={who} className="size-5 rounded-md text-[11px]" /> {who.name}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap tabular-nums">{!s.runsHere ? <span className="text-muted-foreground">On {s.owner ? firstName(s.owner) : "another"}&apos;s machine</span> : s.enabled ? formatRelative(s.nextRunAt) : <span className="text-muted-foreground">Off</span>}</td>
                <td className="px-3 py-3">{s.lastOutcome ? <ToneBadge tone={OUTCOME[s.lastOutcome].tone} size="sm">{OUTCOME[s.lastOutcome].label}</ToneBadge> : <span className="text-muted-foreground">–</span>}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <Switch checked={s.enabled} onCheckedChange={(v) => run(automationApi.updateSchedule(s.id, { enabled: v }), v ? "Schedule on" : "Schedule off")} aria-label={s.enabled ? `Turn off ${s.name}` : `Turn on ${s.name}`} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More for ${s.name}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => run(automationApi.runNow(s.id), "Started")}>
                          <PlayIcon /> Run now
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openSchedule({ id: s.id, name: s.name, when: s.when, action: s.action, scope: s.scope, owner: s.owner })}>Edit</DropdownMenuItem>
                        {!s.runsHere && (
                          <DropdownMenuItem onSelect={() => run(automationApi.updateSchedule(s.id, { owner: "me" }), "It runs on this machine now")}>
                            <MonitorIcon /> Run it here instead
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => run(automationApi.deleteSchedule(s.id), "Schedule deleted")}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function triggerSentence(t: TriggerView, botName: (id?: string) => string): { when: string; then: string } {
  const when =
    t.when.source === "sentry"
      ? `Sentry reports a new ${t.when.level ? `${t.when.level} ` : ""}issue${t.when.project ? ` in ${t.when.project}` : ""}`
      : t.when.source === "github"
        ? `a GitHub card moves to ${t.when.toColumn}`
        : "a goal fails"
  const mode = t.then.planOnly ? "stop after the plan" : "build it"
  const then =
    t.then.type === "handoff"
      ? `hand it to ${botName(t.then.botId)} and ${mode}`
      : t.then.type === "goal"
        ? `start a goal and ${mode}`
        : t.then.type === "message"
          ? `message ${botName(t.then.botId)}`
          : `notify you${t.then.channel && t.then.channel !== "inbox" ? ` on ${t.then.channel === "slack" ? "Slack" : "Teams"}` : ""}`
  return { when, then }
}

function Triggers({ list }: { list: TriggerView[] }) {
  const bots = useAppStore((s) => s.bots)
  const botName = useMemo(() => (id?: string) => bots.find((b) => b.id === id)?.name ?? "the Team Lead", [bots])
  if (!list.length)
    return (
      <EmptyState
        icon={ZapIcon}
        title="No triggers yet"
        description="Start work when something happens: a new fatal Sentry issue, a GitHub card moved to Ready, a goal that failed."
        action={<Button size="sm" onClick={() => openTrigger()}><PlusIcon data-icon="inline-start" /> New trigger</Button>}
      />
    )
  const run = (p: Promise<unknown>, ok: string) => p.then(() => toast.success(ok)).catch((e) => toast.error((e as Error).message))
  return (
    <ul className="space-y-3">
      {list.map((t) => {
        const s = triggerSentence(t, botName)
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-sunken text-brand">
              <ZapIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <button className="text-left font-medium hover:underline" onClick={() => openTrigger(t)}>{t.name}</button>
                <ScopeBadge scope={t.scope} owner={t.owner} runsHere={t.runsHere} />
              </div>
              <p className="text-sm text-muted-foreground">
                When <span className="text-foreground">{s.when}</span>, <span className="text-foreground">{s.then}</span>.
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {t.runsToday} of {t.limits.maxRunsPerDay} runs today
                {t.limits.quietHours ? ` · quiet ${t.limits.quietHours.from}–${t.limits.quietHours.to}` : ""}
                {t.limits.budgetUsd ? ` · $${t.limits.budgetUsd} per run` : ""}
                {t.lastRunAt ? ` · last ${timeAgo(Date.parse(t.lastRunAt))}` : ""}
              </p>
            </div>
            {t.lastOutcome && <ToneBadge tone={OUTCOME[t.lastOutcome].tone} size="sm">{OUTCOME[t.lastOutcome].label}</ToneBadge>}
            <Switch checked={t.enabled} onCheckedChange={(v) => run(automationApi.updateTrigger(t.id, { enabled: v }), v ? "Trigger on" : "Trigger off")} aria-label={t.enabled ? `Turn off ${t.name}` : `Turn on ${t.name}`} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`More for ${t.name}`}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    automationApi
                      .testTrigger(t.id)
                      .then((r) => (r.wouldFire ? toast.success(`Would fire for ${r.event}`, { description: r.action }) : toast.message(r.reason ?? "Wouldn't fire", { description: r.event })))
                      .catch((e) => toast.error((e as Error).message))
                  }
                >
                  Test with the latest event
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openTrigger(t)}>Edit</DropdownMenuItem>
                {!t.runsHere && (
                  <DropdownMenuItem onSelect={() => run(automationApi.updateTrigger(t.id, { owner: "me" }), "It runs on this machine now")}>
                    <MonitorIcon /> Run it here instead
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => run(automationApi.deleteTrigger(t.id), "Trigger deleted")}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        )
      })}
    </ul>
  )
}

function History() {
  const pushed = useAppStore((s) => s.automation?.history)
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const [rows, setRows] = useState<AutomationRun[] | null>(null)
  useEffect(() => {
    automationApi.history(100).then(setRows).catch(() => setRows([]))
  }, [pushed])

  if (!rows) return <LoadingState />
  if (!rows.length) return <EmptyState icon={HistoryIcon} title="No runs yet" description="Every schedule and trigger run shows up here, with its result and cost." />
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
          <span className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums" title={new Date(r.startedAt).toLocaleString()}>
            {timeAgo(Date.parse(r.startedAt))}
          </span>
          <ToneBadge tone="neutral" size="sm" className="capitalize">{r.kind}</ToneBadge>
          <span className="min-w-0 flex-1 truncate">
            {r.name}
            {r.reason && <span className="text-muted-foreground"> · {r.reason}</span>}
          </span>
          {r.goalId && (
            <button className="font-mono text-xs text-brand-ink hover:underline" onClick={() => showOnTasks({ goalId: r.goalId })}>
              {r.goalId}
            </button>
          )}
          {typeof r.costUsd === "number" && r.goalId && <span className="text-xs text-muted-foreground tabular-nums">${r.costUsd.toFixed(2)}</span>}
          <ToneBadge tone={OUTCOME[r.outcome].tone} size="sm">{OUTCOME[r.outcome].label}</ToneBadge>
        </li>
      ))}
    </ul>
  )
}
