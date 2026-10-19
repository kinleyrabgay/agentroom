"use client"

import { useMemo } from "react"
import { GoalStatus, NotificationKind } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { pendingApprovals } from "@/lib/store/selectors"
import { needsAction } from "@/features/connections/lib/meta"

export interface NeedsYou {
  approvals: number
  questions: number
  plans: number
  /** Paused goals with a reason (blocked, gate). */
  blocked: number
  /** MCP servers waiting for a sign-in or token. */
  connections: number
  total: number
}

/** How many things are waiting on the human, by kind. One source for the sidebar, top bar and Inbox. */
export function useNeedsYou(): NeedsYou {
  const events = useAppStore((s) => s.events)
  const questions = useAppStore((s) => s.notifications.filter((n) => n.kind === NotificationKind.Question && !n.answer).length)
  const plans = useAppStore((s) => s.goals.filter((g) => g.status === GoalStatus.AwaitingApproval).length)
  const blocked = useAppStore((s) => s.goals.filter((g) => g.status === GoalStatus.Paused && !!g.reason).length)
  const connections = useAppStore((s) => s.mcp?.servers.filter(needsAction).length ?? 0)
  const approvals = useMemo(() => pendingApprovals(events).length, [events])
  return { approvals, questions, plans, blocked, connections, total: approvals + questions + plans + blocked + connections }
}
