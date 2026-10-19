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
import { cn } from "@/lib/utils"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { UsageMeter } from "@/features/usage/components/usage-meter"
import { InboxButton } from "@/features/inbox/components/inbox-button"

/** A floating, translucent group over the canvas. */
const PILL =
  "pointer-events-auto rounded-full border bg-background/80 p-2 shadow-sm backdrop-blur"

const TITLES: Record<View, [string, string]> = {
  [View.Team]: [
    "Team",
    "Watch your bots work, drop skills on them, click one to talk.",
  ],
  [View.Board]: [
    "Board",
    "Your GitHub project. Pick cards and hand them to the team.",
  ],
  [View.Tasks]: [
    "Tasks",
    "What the bots are building: plans, sub-tasks and progress.",
  ],
  [View.Browser]: [
    "Browser",
    "Your app, live. Bots browse it; you can pick elements and check the console.",
  ],
  [View.Security]: [
    "Security",
    "Findings from the scanner, dependency guard, security reviews and injection guard.",
  ],
  [View.Audit]: [
    "Audit log",
    "Every command, file write, push and approval — and who decided.",
  ],
  [View.Settings]: [
    "Settings",
    "Team-wide defaults, your alerts, and integrations.",
  ],
}

/** `floating`: over the full-page Team canvas — transparent bar with two floating pills, clicks pass through the gaps. */
export function TopBar({ floating = false }: { floating?: boolean }) {
  const view = useAppStore((s) => s.view)
  const events = useAppStore((s) => s.events)
  const anyBusy = useAppStore((s) =>
    Object.values(s.statuses).some((st) => isBusy(st.status))
  )
  const pending = useMemo(() => pendingApprovals(events).length, [events])
  const [title, subtitle] = TITLES[view]

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-2 px-4",
        floating ? "pointer-events-none pt-2 pr-2" : "border-b"
      )}
    >
      <div className={cn("flex min-w-0 items-center gap-2", floating && PILL)}>
        <SidebarTrigger className="-ml-1" />
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="font-medium">{title}</h1>
          <span className="truncate text-sm text-muted-foreground">
            {subtitle}
          </span>
        </div>
      </div>
      <div className={cn("flex items-center gap-2", floating && PILL)}>
        {pending > 0 && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-300"
          >
            <ShieldAlertIcon /> {pending} waiting for approval
          </Badge>
        )}
        <UsageMeter />
        <InboxButton />
        <Button
          variant="destructive"
          size="sm"
          disabled={!anyBusy}
          onClick={() => send({ type: ClientMessageType.Stop })}
        >
          <OctagonXIcon data-icon="inline-start" /> Stop all
        </Button>
      </div>
    </header>
  )
}
