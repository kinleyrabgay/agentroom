"use client"

import { useEffect } from "react"
import { BotTab, View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { useGithubStore } from "@/features/github/lib/github-store"
import { setSentry, useSentryStore } from "@/features/sentry/lib/sentry-store"
import { CONTEXT_TABS, openModule, setContextTab, useContextStore, type ContextTab } from "@/features/context/lib/context-store"
import { setTracker, useTrackerStore } from "@/features/issues/lib/tracker-store"
import { setReviews, useReviewStore } from "@/features/reviews/lib/review-store"

/**
 * Hash routes for a static export (the session token stays in the query string):
 *
 *   #/team                      #/inbox
 *   #/work/G-3/T-2              #/github/<itemId>
 *   #/sentry/<issueId>          #/browser
 *   #/context/<moduleId>        #/context/ask|tour|docs[/<moduleId>]
 *   #/linear/<issueId>          #/jira/<issueId>
 *   #/reviews/<reviewId>
 *   #/security?goal=G-1         #/audit
 *   #/settings/integrations
 *
 * Any route may add `?bot=<id>&tab=<tab>` for the bot open in the side panel.
 * The stores stay the source of truth; this keeps the URL in step both ways.
 */
interface Route {
  view: View
  parts: string[]
  bot: string | null
  tab: BotTab | null
  goal: string | null
}

const VIEWS = new Set<string>(Object.values(View))
const TABS = new Set<string>(Object.values(BotTab))

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?")
  const [first, ...parts] = path.split("/").filter(Boolean).map(decodeURIComponent)
  // Old names keep working.
  const alias: Record<string, View> = { board: View.Github, tasks: View.Work }
  const view = (first && (alias[first] ?? (VIEWS.has(first) ? (first as View) : null))) || View.Team
  const q = new URLSearchParams(query)
  const tab = q.get("tab")
  return { view, parts, bot: q.get("bot"), tab: tab && TABS.has(tab) ? (tab as BotTab) : null, goal: q.get("goal") }
}

/** The hash for the current state. */
export function currentHash(): string {
  const a = useAppStore.getState()
  const parts: string[] = []
  if (a.view === View.Work) {
    if (a.selectedGoalId) parts.push(a.selectedGoalId)
    if (a.selectedTaskId) parts.push(a.selectedTaskId)
  } else if (a.view === View.Github) {
    const id = useGithubStore.getState().openItemId
    if (id) parts.push(id)
  } else if (a.view === View.Sentry) {
    const id = useSentryStore.getState().openIssueId
    if (id) parts.push(id)
  } else if (a.view === View.Context) {
    const { openModuleId: id, tab } = useContextStore.getState()
    // #/context/<module> on the map; #/context/<tab>[/<module>] elsewhere (and for modules named like a tab).
    if (tab !== "map" || (id && CONTEXT_TABS.includes(id as ContextTab))) parts.push(tab)
    if (id) parts.push(id)
  } else if (a.view === View.Linear || a.view === View.Jira) {
    const id = useTrackerStore.getState()[a.view].openIssueId
    if (id) parts.push(id)
  } else if (a.view === View.Reviews) {
    const id = useReviewStore.getState().openId
    if (id) parts.push(id)
  } else if (a.view === View.Settings && a.settingsSection) {
    parts.push(a.settingsSection)
  }
  const q = new URLSearchParams()
  if (a.view === View.Security && a.securityGoalId) q.set("goal", a.securityGoalId)
  if (a.selectedBot) {
    q.set("bot", a.selectedBot)
    if (a.botTab !== BotTab.Chat) q.set("tab", a.botTab)
  }
  const path = [a.view, ...parts].map(encodeURIComponent).join("/")
  const qs = q.toString()
  return `#/${path}${qs ? `?${qs}` : ""}`
}

function apply(route: Route) {
  const [a, b] = route.parts
  useAppStore.setState((s) => ({
    view: route.view,
    selectedBot: route.bot,
    botTab: route.tab ?? (route.bot === s.selectedBot ? s.botTab : BotTab.Chat),
    ...(route.view === View.Work ? { selectedGoalId: a ?? s.selectedGoalId, selectedTaskId: b ?? null } : {}),
    ...(route.view === View.Security ? { securityGoalId: route.goal } : {}),
    ...(route.view === View.Settings ? { settingsSection: a ?? null } : {}),
  }))
  if (route.view === View.Github) useGithubStore.setState({ openItemId: a ?? null })
  if (route.view === View.Sentry) setSentry({ openIssueId: a ?? null })
  if (route.view === View.Context) {
    const isTab = !!a && CONTEXT_TABS.includes(a as ContextTab)
    const tab: ContextTab = isTab ? (a as ContextTab) : "map"
    const id = (isTab ? b : a) ?? null
    if (tab !== useContextStore.getState().tab) setContextTab(tab)
    if (id !== useContextStore.getState().openModuleId) openModule(id)
  }
  if (route.view === View.Linear || route.view === View.Jira) setTracker(route.view, { openIssueId: a ?? null })
  if (route.view === View.Reviews) setReviews({ openId: a ?? null })
}

/** Mount once: reads the hash on load and on back/forward, writes it when navigation state changes. */
export function RouteSync() {
  useEffect(() => {
    let applying = false
    const fromLocation = () => {
      applying = true
      apply(parseHash(location.hash))
      applying = false
    }
    fromLocation()

    let last = currentHash()
    if (location.hash !== last) history.replaceState(null, "", last)

    const write = () => {
      if (applying) return
      const next = currentHash()
      if (next === last) return
      // A new page or item is a history step; bot/tab changes just update the address.
      const step = next.split("?")[0] !== last.split("?")[0]
      last = next
      if (step) history.pushState(null, "", next)
      else history.replaceState(null, "", next)
    }
    const onPop = () => {
      fromLocation()
      last = currentHash()
    }
    window.addEventListener("hashchange", onPop)
    window.addEventListener("popstate", onPop)
    const unsubs = [useAppStore.subscribe(write), useGithubStore.subscribe(write), useSentryStore.subscribe(write), useContextStore.subscribe(write), useTrackerStore.subscribe(write), useReviewStore.subscribe(write)]
    return () => {
      window.removeEventListener("hashchange", onPop)
      window.removeEventListener("popstate", onPop)
      unsubs.forEach((u) => u())
    }
  }, [])
  return null
}
