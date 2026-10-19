"use client"

import { AwayBrief } from "@/features/automation/components/away-brief"

import { useEffect, useMemo, useState } from "react"
import {
  CheckCheckIcon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  MessageCircleQuestionIcon,
  PlayIcon,
  PlugIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { GoalStatus, plainText, type Goal, type McpServerState, type Notification } from "@shared"
import { goalApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { pendingApprovals, type PermissionRequest } from "@/lib/store/selectors"
import { Button } from "@/components/ui/button"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { PageActions } from "@/components/layout/page-actions"
import { ToneBadge } from "@/components/kit/badge"
import { EmptyState } from "@/components/kit/state-view"
import { ApprovalCard } from "@/features/approvals/components/approval-card"
import { gateFindings } from "@/features/approvals/components/security-gate-card"
import { answerPermission } from "@/features/approvals/lib/actions"
import { needsAction, STATUS_META as MCP_STATUS } from "@/features/connections/lib/meta"
import { markRead } from "../lib/actions"
import { needsAnswer } from "../lib/route"
import { NotificationItem } from "./notification-item"
import { QuestionAnswer } from "./question-answer"

const RECENT_LIMIT = 30

/**
 * Everything waiting on you, actionable in place: approvals, questions, plans to review,
 * paused goals and integrations that need a sign-in. Then recent activity.
 * Keys: A approves and D denies the focused (or first) approval.
 */
export function InboxPage() {
  const events = useAppStore((s) => s.events)
  const notifications = useAppStore((s) => s.notifications)
  const goals = useAppStore((s) => s.goals)
  const mcp = useAppStore((s) => s.mcp)

  const approvals = useMemo(() => pendingApprovals(events), [events])
  const questions = useMemo(() => notifications.filter(needsAnswer).sort((a, b) => b.ts - a.ts), [notifications])
  const plans = useMemo(() => goals.filter((g) => g.status === GoalStatus.AwaitingApproval), [goals])
  const paused = useMemo(() => goals.filter((g) => g.status === GoalStatus.Paused && !!g.reason), [goals])
  const integrations = useMemo(() => mcp?.servers.filter(needsAction) ?? [], [mcp])
  const recent = useMemo(
    () => notifications.filter((n) => !needsAnswer(n)).sort((a, b) => b.ts - a.ts).slice(0, RECENT_LIMIT),
    [notifications]
  )
  const unread = recent.filter((n) => !n.read).length
  const waiting = approvals.length + questions.length + plans.length + paused.length + integrations.length

  useApprovalKeys(approvals)

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <PageActions>
        <Button size="sm" variant="ghost" disabled={!unread} onClick={() => markRead(recent.filter((n) => !n.read).map((n) => n.id))}>
          <CheckCheckIcon data-icon="inline-start" /> Mark all read
        </Button>
      </PageActions>

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-5 pb-24">
        <AwayBrief />
        {waiting === 0 ? (
          <EmptyState
            icon={CheckCheckIcon}
            title="You're all caught up"
            description="Approvals, questions from bots and plans to review land here. Nothing is waiting on you right now."
            className="rounded-2xl border border-dashed py-14"
          />
        ) : (
          <Summary
            items={[
              { id: "approvals", label: "Approvals", count: approvals.length },
              { id: "questions", label: "Questions", count: questions.length },
              { id: "plans", label: "Plans to review", count: plans.length },
              { id: "paused", label: "Paused goals", count: paused.length },
              { id: "integrations", label: "Integrations", count: integrations.length },
            ]}
          />
        )}

        {approvals.length > 0 && (
          <Section id="approvals" icon={ShieldAlertIcon} title="Approvals" count={approvals.length} hint="Press A to approve or D to deny the highlighted request.">
            {approvals.map((p, i) => (
              <div key={p.requestId} data-request-id={p.requestId} tabIndex={-1} className="rounded-xl outline-none focus-within:ring-2 focus-within:ring-ring/50 focus:ring-2 focus:ring-ring/50">
                <ApprovalCard request={p} shortcuts={i === 0 && !gateFindings(p).length} />
              </div>
            ))}
          </Section>
        )}

        {questions.length > 0 && (
          <Section id="questions" icon={MessageCircleQuestionIcon} title="Questions from bots" count={questions.length}>
            {questions.map((n) => (
              <QuestionCard key={n.id} n={n} />
            ))}
          </Section>
        )}

        {plans.length > 0 && (
          <Section id="plans" icon={ClipboardCheckIcon} title="Plans to review" count={plans.length} hint="Nothing is built until you approve.">
            {plans.map((g) => (
              <GoalRow key={g.id} goal={g} />
            ))}
          </Section>
        )}

        {paused.length > 0 && (
          <Section id="paused" icon={CircleAlertIcon} title="Paused goals" count={paused.length}>
            {paused.map((g) => (
              <GoalRow key={g.id} goal={g} />
            ))}
          </Section>
        )}

        {integrations.length > 0 && (
          <Section id="integrations" icon={PlugIcon} title="Integrations" count={integrations.length} hint="Bots run without these until they're connected.">
            {integrations.map((s) => (
              <IntegrationRow key={s.name} server={s} />
            ))}
          </Section>
        )}

        <section aria-labelledby="inbox-recent" className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 id="inbox-recent" className="text-sm font-semibold">
              Recent
            </h2>
            {unread > 0 && <span className="text-xs text-muted-foreground">{unread} unread</span>}
          </div>
          {recent.length ? (
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {recent.map((n) => (
                <NotificationItem key={n.id} n={n} />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Finished goals, failures and notes from bots show up here.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

/** Counts per kind, linking to their sections. */
function Summary({ items }: { items: { id: string; label: string; count: number }[] }) {
  const shown = items.filter((i) => i.count > 0)
  return (
    <nav aria-label="Waiting on you" className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium">Waiting on you</span>
      {shown.map((i) => (
        <a
          key={i.id}
          href={`#inbox-${i.id}`}
          onClick={(e) => {
            // Hash routing owns location.hash; scroll instead of navigating.
            e.preventDefault()
            document.getElementById(`inbox-${i.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
          }}
          className="tone-warning tone-soft inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {i.label}
          <span className="tabular-nums opacity-80">{i.count}</span>
        </a>
      ))}
    </nav>
  )
}

function Section({ id, icon: Icon, title, count, hint, children }: { id: string; icon: LucideIcon; title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <section id={`inbox-${id}`} aria-labelledby={`inbox-${id}-title`} className="scroll-mt-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Icon className="size-4 self-center text-muted-foreground" aria-hidden />
        <h2 id={`inbox-${id}-title`} className="text-sm font-semibold">
          {title}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        {hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function QuestionCard({ n }: { n: Notification }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === n.botId))
  return (
    <article className="space-y-3 rounded-xl border bg-card p-4">
      <header className="flex items-center gap-2">
        {bot && <BotAvatar bot={bot} className="size-6 rounded-md text-xs" />}
        <span className="text-sm font-medium">{n.title}</span>
        <ToneBadge tone="info" size="sm" className="ml-auto">
          Waiting for your answer
        </ToneBadge>
      </header>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{n.body}</p>
      <QuestionAnswer n={n} />
    </article>
  )
}

function GoalRow({ goal }: { goal: Goal }) {
  const taskCount = useAppStore((s) => s.tasks.filter((t) => t.goalId === goal.id).length)
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const [busy, setBusy] = useState(false)
  const awaiting = goal.status === GoalStatus.AwaitingApproval

  const act = async () => {
    setBusy(true)
    try {
      if (awaiting) {
        await goalApi.approve(goal.id)
        toast.success("Plan approved", { description: "The Developer is starting on the first task." })
      } else {
        await goalApi.resume(goal.id)
        toast.success(`${goal.id} resumed`)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border bg-card p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{goal.id}</span>
          <ToneBadge tone="warning" size="sm" dot>
            {awaiting ? "Plan ready" : "Paused"}
          </ToneBadge>
        </div>
        <p className="truncate font-medium">{goal.title}</p>
        <p className="line-clamp-2 text-[13px] text-muted-foreground">
          {awaiting
            ? `${taskCount} ${taskCount === 1 ? "task" : "tasks"} planned. Review or edit them on the board first if you like.`
            : plainText(goal.reason ?? "", 240)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => showOnTasks({ goalId: goal.id })}>
          {awaiting ? "Review on board" : "Open goal"}
        </Button>
        <Button size="sm" onClick={act} disabled={busy || (awaiting && taskCount === 0)}>
          {awaiting ? <ClipboardCheckIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          {awaiting ? "Approve plan" : "Resume"}
        </Button>
      </div>
    </article>
  )
}

function IntegrationRow({ server: s }: { server: McpServerState }) {
  const meta = MCP_STATUS[s.status]
  return (
    <article className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted font-mono text-xs font-semibold uppercase">{s.name.slice(0, 2)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm font-medium">{s.name}</p>
        {s.error && <p className="truncate font-mono text-xs text-muted-foreground">{s.error}</p>}
      </div>
      <ToneBadge tone={meta.tone} icon={meta.icon}>
        {meta.label}
      </ToneBadge>
      <Button size="sm" variant="outline" onClick={() => useAppStore.getState().showSettings("integrations")}>
        Fix in Settings
      </Button>
    </article>
  )
}

/** A approves and D denies the focused approval, or the first one that doesn't need a review checkbox. */
function useApprovalKeys(approvals: PermissionRequest[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const key = e.key.toLowerCase()
      if (key !== "a" && key !== "d") return
      const t = e.target as HTMLElement | null
      if (t && (t.closest("input, textarea, select, [contenteditable=true], [role=combobox], [role=dialog]") || t.isContentEditable)) return
      const focusedId = (document.activeElement?.closest("[data-request-id]") as HTMLElement | null)?.dataset.requestId
      const target = approvals.find((p) => p.requestId === focusedId) ?? approvals.find((p) => !gateFindings(p).length)
      // Security gates need the "I reviewed" checkbox; no shortcut approves them.
      if (!target || gateFindings(target).length) return
      e.preventDefault()
      answerPermission(target.requestId, key === "a")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [approvals])
}
