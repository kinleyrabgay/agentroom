"use client"

import { useMemo } from "react"
import { OctagonXIcon, ShieldAlertIcon } from "lucide-react"
import { ClientMessageType } from "@shared"
import { isBusy, View } from "@/lib/constants"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { pendingApprovals } from "@/lib/store/selectors"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { UsageMeter } from "@/features/usage/components/usage-meter"
import { InboxButton } from "@/features/inbox/components/inbox-button"

const TITLES: Record<View, [string, string]> = {
  [View.Team]: ["Team", "Watch your bots work, drop skills on them, click one to talk."],
  [View.Board]: ["Board", "Your GitHub project. Pick cards and hand them to the team."],
  [View.Tasks]: ["Tasks", "What the bots are building: plans, sub-tasks and progress."],
  [View.Browser]: ["Browser", "Your app, live. Bots browse it; you can pick elements and check the console."],
  [View.Security]: ["Security", "Findings from the scanner, dependency guard, security reviews and injection guard."],
  [View.Audit]: ["Audit log", "Every command, file write, push and approval — and who decided."],
  [View.Settings]: ["Settings", "Team-wide defaults, your alerts, and integrations."],
}

export function TopBar() {
  const view = useAppStore((s) => s.view)
  const events = useAppStore((s) => s.events)
  const anyBusy = useAppStore((s) => Object.values(s.statuses).some((st) => isBusy(st.status)))
  const pending = useMemo(() => pendingApprovals(events).length, [events])
  const [title, subtitle] = TITLES[view]

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="font-medium">{title}</h1>
        <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {pending > 0 && (
          <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-300">
            <ShieldAlertIcon /> {pending} waiting for approval
          </Badge>
        )}
        <UsageMeter />
        <InboxButton />
        <Button variant="destructive" size="sm" disabled={!anyBusy} onClick={() => send({ type: ClientMessageType.Stop })}>
          <OctagonXIcon data-icon="inline-start" /> Stop all
        </Button>
      </div>
    </header>
  )
}
