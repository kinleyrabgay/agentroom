"use client"

import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { BotPanel } from "@/features/bot-panel/components/bot-panel"
import { BrowserWorkspace } from "@/features/browser/components/browser-workspace"
import { CommandBar } from "@/features/command/components/command-bar"
import { TaskBoard } from "@/features/tasks/components/task-board"
import { GithubBoard } from "@/features/github/components/github-board"
import { TeamCanvas } from "@/features/team/components/team-canvas"
import { AuditPage } from "@/features/audit/components/audit-page"
import { SecurityPage } from "@/features/security/components/security-page"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { SettingsPage } from "@/features/settings/components/settings-page"

const VIEWS: Record<View, React.ComponentType> = {
  [View.Team]: TeamCanvas,
  [View.Board]: GithubBoard,
  [View.Tasks]: TaskBoard,
  [View.Browser]: BrowserWorkspace,
  [View.Security]: SecurityPage,
  [View.Audit]: AuditPage,
  [View.Settings]: SettingsPage,
}

const VIEW_LABEL: Record<View, string> = {
  [View.Team]: "Team",
  [View.Board]: "Board",
  [View.Tasks]: "Tasks",
  [View.Browser]: "Browser",
  [View.Security]: "Security",
  [View.Audit]: "Audit log",
  [View.Settings]: "Settings",
}

/** Views that take a goal from the command bar. */
const WITH_COMMAND_BAR = new Set<View>([View.Team, View.Tasks])

/**
 * Main view on the left, the selected bot's panel floating on the right (resizable).
 * On the Team view the canvas is drawn full-window by the app shell, so this layer is transparent
 * and lets clicks through to it except on the bot panel and command bar.
 */
export function Workspace() {
  const view = useAppStore((s) => s.view)
  const selected = useAppStore((s) => s.selectedBot)
  const overCanvas = view === View.Team
  const Main = VIEWS[view]

  return (
    <ResizablePanelGroup orientation="horizontal" className={cn("min-h-0 flex-1", overCanvas && "pointer-events-none")}>
      <ResizablePanel id="main" minSize="30%">
        <div className="flex h-full flex-col">
          <div className="relative min-h-0 flex-1">
            {!overCanvas && (
              // Keyed by view: switching views clears a crashed section.
              <ErrorBoundary key={view} label={VIEW_LABEL[view]}>
                <Main />
              </ErrorBoundary>
            )}
          </div>
          {WITH_COMMAND_BAR.has(view) && <CommandBar floating={overCanvas} />}
        </div>
      </ResizablePanel>
      {selected && (
        <>
          {/* Invisible gap you can still drag; the grip shows on hover. */}
          <ResizableHandle
            withHandle
            className="pointer-events-auto w-2 bg-transparent opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          />
          <ResizablePanel id="bot" defaultSize="42%" minSize="28%" maxSize="70%">
            {/* Floating panel, matching the floating sidebar and sheets. */}
            <div className="h-full py-2 pr-2">
              <div data-bot-panel className="pointer-events-auto h-full overflow-hidden rounded-2xl border bg-background shadow-lg">
                <BotPanel botId={selected} />
              </div>
            </div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
