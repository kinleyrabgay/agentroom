"use client"

import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { BotPanel } from "@/features/bot-panel/components/bot-panel"
import { BrowserWorkspace } from "@/features/browser/components/browser-workspace"
import { CommandBar } from "@/features/command/components/command-bar"
import { TaskBoard } from "@/features/tasks/components/task-board"
import { GithubBoard } from "@/features/github/components/github-board"
import { TeamCanvas } from "@/features/team/components/team-canvas"

const VIEWS: Record<View, React.ComponentType> = {
  [View.Team]: TeamCanvas,
  [View.Board]: GithubBoard,
  [View.Tasks]: TaskBoard,
  [View.Browser]: BrowserWorkspace,
}

/** Main view on the left, the selected bot's panel on the right (resizable). */
export function Workspace() {
  const view = useAppStore((s) => s.view)
  const selected = useAppStore((s) => s.selectedBot)
  const Main = VIEWS[view]

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel id="main" minSize="30%">
        <div className="flex h-full flex-col">
          <div className="relative min-h-0 flex-1">
            <Main />
          </div>
          {view !== View.Browser && view !== View.Board && <CommandBar />}
        </div>
      </ResizablePanel>
      {selected && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="bot" defaultSize="42%" minSize="28%" maxSize="70%">
            <BotPanel botId={selected} />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
