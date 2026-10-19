"use client"

import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { Approvals } from "@/features/approvals/components/approvals"
import { PreviewHost } from "@/features/browser/components/preview-host"
import { NotificationEffects } from "@/features/inbox/hooks/use-notification-effects"
import { TeamCanvas } from "@/features/team/components/team-canvas"
import { AppSidebar } from "./app-sidebar"
import { TokenGate } from "./token-gate"
import { TopBar } from "./top-bar"
import { Workspace } from "./workspace"

export function AppShell() {
  const view = useAppStore((s) => s.view)
  // On Team the canvas is the page: it fills the window and everything else floats over it.
  const fullCanvas = view === View.Team

  return (
    <TokenGate>
      <SidebarProvider className="h-svh">
        {fullCanvas && (
          <div className="fixed inset-0 z-0">
            <ErrorBoundary label="Team">
              <TeamCanvas fullBleed />
            </ErrorBoundary>
          </div>
        )}
        <AppSidebar />
        <SidebarInset
          className={cn("min-w-0 overflow-hidden", fullCanvas && "pointer-events-none z-10 bg-transparent")}
        >
          <TopBar floating={fullCanvas} />
          <Workspace />
          <Approvals />
        </SidebarInset>
        <PreviewHost />
        <NotificationEffects />
      </SidebarProvider>
    </TokenGate>
  )
}
