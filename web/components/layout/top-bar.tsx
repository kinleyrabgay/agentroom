"use client"

import { InboxIcon, OctagonXIcon } from "lucide-react"
import { ClientMessageType } from "@shared"
import { isBusy, View } from "@/lib/constants"
import { send } from "@/lib/realtime/socket"
import { VIEW_META } from "@/lib/views"
import { useAppStore } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"
import { useNeedsYou } from "@/hooks/use-needs-you"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { NextRunPill } from "@/features/automation/components/next-run-pill"
import { UsageMeter } from "@/features/usage/components/usage-meter"
import { InboxButton } from "@/features/inbox/components/inbox-button"
import { PAGE_ACTIONS_ID } from "./page-actions"
import { RoomGuards, RoomPresence } from "@/features/room/components/room-presence"
import { useCanDecide, useIsMember } from "@/features/room/lib/room-store"

/** A floating, translucent group over the canvas. */
const PILL = "pointer-events-auto rounded-full border bg-background/85 p-1.5 shadow-sm backdrop-blur-md"

/**
 * Page title and description, the page's own actions (portal slot), then what's global:
 * what needs you, spend, alerts and Stop all.
 * `floating`: over the full-page Team canvas, as two pills with clicks passing through the gap.
 */
export function TopBar({ floating = false }: { floating?: boolean }) {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const anyBusy = useAppStore((s) => Object.values(s.statuses).some((st) => isBusy(st.status)))
  const needs = useNeedsYou()
  const member = useIsMember()
  const canStop = useCanDecide()
  const { label, description, icon: Icon } = VIEW_META[view]

  return (
    <header className={cn("flex h-14 shrink-0 items-center gap-3 px-4", floating ? "pointer-events-none pt-2 pr-2" : "border-b")}>
      <div className={cn("flex min-w-0 items-center gap-2", floating && cn(PILL, "pr-4"))}>
        <SidebarTrigger className="-ml-0.5" />
        <Separator orientation="vertical" className="mr-1 h-4! data-[orientation=vertical]:self-center" />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="shrink-0 text-[15px] font-semibold tracking-tight">{label}</h1>
        <p className="hidden min-w-0 truncate text-sm text-muted-foreground xl:block">{description}</p>
      </div>

      <div id={PAGE_ACTIONS_ID} className={cn("ml-auto flex items-center gap-2 empty:hidden", floating && "pointer-events-auto")} />

      <div className={cn("flex items-center gap-1.5", !floating && "ml-auto [#page-actions:not(:empty)+&]:ml-0", floating && PILL)}>
        {needs.total > 0 && view !== View.Inbox && (
          <button
            onClick={() => setView(View.Inbox)}
            className="tone-warning tone-soft inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 whitespace-nowrap text-[13px] font-medium transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <span className="relative flex size-2">
              <span className="tone-solid absolute inset-0 animate-ping rounded-full opacity-60" />
              <span className="tone-solid relative size-2 rounded-full" />
            </span>
            {needs.total} {needs.total === 1 ? "needs you" : "need you"}
            <InboxIcon className="size-3.5 opacity-70" />
          </button>
        )}
        {/* Optional widgets: a failure in one hides it, never the whole app. */}
        <ErrorBoundary label="Team room" compact fallback={null}>
          <RoomPresence />
          <RoomGuards />
        </ErrorBoundary>
        {view !== View.Automation && !member && (
          <ErrorBoundary label="Next run" compact fallback={null}>
            <NextRunPill />
          </ErrorBoundary>
        )}
        {!member && (
          <ErrorBoundary label="Usage" compact fallback={null}>
            <UsageMeter />
          </ErrorBoundary>
        )}
        <ErrorBoundary label="Alerts" compact fallback={null}>
          <InboxButton />
        </ErrorBoundary>
        {anyBusy && canStop && (
          <Button variant="outline" size="sm" className="tone-danger tone-text" onClick={() => send({ type: ClientMessageType.Stop })}>
            <OctagonXIcon data-icon="inline-start" /> Stop all
          </Button>
        )}
      </div>
    </header>
  )
}
