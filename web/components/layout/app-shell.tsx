"use client"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Approvals } from "@/features/approvals/components/approvals"
import { PreviewHost } from "@/features/browser/components/preview-host"
import { NotificationEffects } from "@/features/inbox/hooks/use-notification-effects"
import { AppSidebar } from "./app-sidebar"
import { TokenGate } from "./token-gate"
import { TopBar } from "./top-bar"
import { Workspace } from "./workspace"

export function AppShell() {
  return (
    <TokenGate>
      <SidebarProvider className="h-svh">
        <AppSidebar />
        <SidebarInset className="min-w-0 overflow-hidden">
          <TopBar />
          <Workspace />
          <Approvals />
        </SidebarInset>
        <PreviewHost />
        <NotificationEffects />
      </SidebarProvider>
    </TokenGate>
  )
}
