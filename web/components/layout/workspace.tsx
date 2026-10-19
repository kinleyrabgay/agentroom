"use client"

import { useState } from "react"
import { BotIcon, PanelRightIcon } from "lucide-react"
import { View } from "@/lib/constants"
import { VIEW_META } from "@/lib/views"
import { useAppStore } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { Segmented } from "@/components/kit/segmented"
import { BotPanel } from "@/features/bot-panel/components/bot-panel"
import { BrowserWorkspace } from "@/features/browser/components/browser-workspace"
import { CommandBar } from "@/features/command/components/command-bar"
import { AutomationPage } from "@/features/automation/components/automation-page"
import { TaskBoard } from "@/features/tasks/components/task-board"
import { GithubBoard } from "@/features/github/components/github-board"
import { SentryPage } from "@/features/sentry/components/sentry-page"
import { TeamCanvas } from "@/features/team/components/team-canvas"
import { AuditPage } from "@/features/audit/components/audit-page"
import { InsightsPage } from "@/features/insights/components/insights-page"
import { SecurityPage } from "@/features/security/components/security-page"
import { InboxPage } from "@/features/inbox/components/inbox-page"
import { ConnectionsPage } from "@/features/connections/components/connections-page"
import { SettingsPage } from "@/features/settings/components/settings-page"
import { useInspectorDetail } from "./inspector-details"

const VIEWS: Record<View, React.ComponentType> = {
  [View.Team]: TeamCanvas,
  [View.Inbox]: InboxPage,
  [View.Work]: TaskBoard,
  [View.Automation]: AutomationPage,
  [View.Github]: GithubBoard,
  [View.Sentry]: SentryPage,
  [View.Browser]: BrowserWorkspace,
  [View.Security]: SecurityPage,
  [View.Audit]: AuditPage,
  [View.Insights]: InsightsPage,
  [View.Connections]: ConnectionsPage,
  [View.Settings]: SettingsPage,
}

/** Views that take a goal from the command bar. */
const WITH_COMMAND_BAR = new Set<View>([View.Team, View.Work])

type Focus = "detail" | "bot"

const WIDTH_KEY = "agentroom.inspector.width"
const MIN_WIDTH = 380
/** Never wider than this share of the window. */
const MAX_SHARE = 0.7
const DEFAULT_SHARE = 0.4

function initialWidth() {
  if (typeof window === "undefined") return 560
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    if (saved >= MIN_WIDTH) return saved
  } catch {
    // storage blocked
  }
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * DEFAULT_SHARE))
}

/**
 * The page fills the space; the Inspector floats over it on the right (it never squeezes the page).
 * It shows the page's open detail (issue, card, task) or a bot, with a switch when both are open;
 * the most recently opened one comes to the front. Drag its left edge to resize (remembered).
 * On Team the canvas is drawn full-window by the shell; this layer lets clicks through to it.
 */
export function Workspace() {
  const view = useAppStore((s) => s.view)
  const selected = useAppStore((s) => s.selectedBot)
  const bot = useAppStore((s) => s.bots.find((b) => b.id === s.selectedBot))
  const detail = useInspectorDetail()
  const overCanvas = view === View.Team
  const Main = VIEWS[view]

  // Whatever opened last comes to the front (derived during render, no effect needed).
  const [focus, setFocus] = useState<Focus>("bot")
  const [seen, setSeen] = useState({ bot: selected, detail: detail?.key ?? null })
  if (seen.bot !== selected || seen.detail !== (detail?.key ?? null)) {
    if (detail && detail.key !== seen.detail) setFocus("detail")
    else if (selected && selected !== seen.bot) setFocus("bot")
    setSeen({ bot: selected, detail: detail?.key ?? null })
  }
  const showing: Focus | null = detail && selected ? focus : detail ? "detail" : selected ? "bot" : null

  const [width, setWidth] = useState(initialWidth)
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    let last = startW
    const move = (ev: PointerEvent) => {
      last = Math.min(Math.round(window.innerWidth * MAX_SHARE), Math.max(MIN_WIDTH, startW + (startX - ev.clientX)))
      setWidth(last)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.style.removeProperty("cursor")
      try {
        localStorage.setItem(WIDTH_KEY, String(last))
      } catch {
        // storage blocked
      }
    }
    document.body.style.cursor = "col-resize"
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }
  const nudge = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0
    if (!step) return
    e.preventDefault()
    setWidth((w) => Math.min(Math.round(window.innerWidth * MAX_SHARE), Math.max(MIN_WIDTH, w + step)))
  }

  return (
    <div
      className={cn("relative min-h-0 flex-1", overCanvas && "pointer-events-none")}
      // Floating chrome (the Team composer) keeps clear of the open Inspector.
      style={{ "--inspector-space": showing ? `${width + 16}px` : "0px" } as React.CSSProperties}
    >
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1">
          {!overCanvas && (
            // Keyed by view: switching views clears a crashed section.
            <ErrorBoundary key={view} label={VIEW_META[view].label}>
              <Main />
            </ErrorBoundary>
          )}
        </div>
        {WITH_COMMAND_BAR.has(view) && (
          <div className="pr-(--inspector-space) transition-[padding] duration-200">
            <CommandBar floating={overCanvas} />
          </div>
        )}
      </div>

      {showing && (
        <aside
          data-bot-panel
          aria-label="Inspector"
          style={{ width: `min(${width}px, calc(100vw - 1rem))` }}
          className="pointer-events-auto fixed top-16 right-2 bottom-2 z-30 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl animate-in fade-in-0 slide-in-from-right-4 duration-200"
        >
          {/* Resize from the left edge; arrow keys when focused. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuenow={width}
            aria-valuemin={MIN_WIDTH}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={nudge}
            className="group/resize absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize outline-none"
          >
            <span className="absolute inset-y-6 left-0.5 w-0.5 rounded-full bg-brand opacity-0 transition-opacity group-hover/resize:opacity-60 group-focus-visible/resize:opacity-100" />
          </div>
          {detail && selected && bot && (
            <div className="flex items-center justify-center border-b bg-sunken/60 px-3 py-1.5">
              <Segmented<Focus>
                size="sm"
                aria-label="Inspector shows"
                value={showing}
                onChange={setFocus}
                options={[
                  { value: "detail", label: <><PanelRightIcon className="size-3.5" /> {detail.label}</> },
                  { value: "bot", label: <><BotIcon className="size-3.5" /> {bot.name}</> },
                ]}
              />
            </div>
          )}
          <div className="min-h-0 flex-1">
            {showing === "detail" && detail ? (
              <ErrorBoundary key={detail.key} label="Details">
                {detail.node}
              </ErrorBoundary>
            ) : selected ? (
              <BotPanel botId={selected} />
            ) : null}
          </div>
        </aside>
      )}
    </div>
  )
}
