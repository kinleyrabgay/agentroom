"use client"

import { useEffect } from "react"
import { EyeIcon, LogOutIcon, SettingsIcon, ShieldCheckIcon, UsersIcon } from "lucide-react"
import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToneBadge } from "@/components/kit/badge"
import { cn } from "@/lib/utils"
import { isMember, ROLE_LABEL, useRoomStore } from "../lib/room-store"
import { PersonAvatar } from "./person-avatar"

const STACK = 4

/** Views a teammate can't use (they run on the owner's own tokens or settings). */
export const OWNER_ONLY_VIEWS = new Set<View>([View.Automation, View.Github, View.Sentry, View.Browser, View.Settings, View.Connections])

/**
 * Top bar: who's here. Teammates see their role; everyone sees the people connected right now.
 * Hidden when you're alone.
 */
export function RoomPresence() {
  const me = useRoomStore((s) => s.me)
  const online = useRoomStore((s) => s.online)
  const member = isMember(me)
  const others = online.filter((p) => p.id !== me?.id)
  if (!me || (!member && (!me.roomEnabled || others.length === 0))) return null

  const shown = online.slice(0, STACK)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex h-8 shrink-0 items-center gap-2 rounded-full border bg-background pr-2.5 pl-1 text-[13px] font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          aria-label={`${online.length} ${online.length === 1 ? "person" : "people"} in the room`}
        >
          <span className="flex -space-x-1">
            {shown.map((p) => (
              <PersonAvatar key={p.id} name={p.name} email={p.email} className="size-6 text-[9px] ring-2 ring-background" />
            ))}
          </span>
          {online.length > STACK && <span className="text-xs text-muted-foreground tabular-nums">+{online.length - STACK}</span>}
          {member ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              {me.role === "viewer" ? <EyeIcon className="size-3.5" /> : <ShieldCheckIcon className="size-3.5" />}
              {ROLE_LABEL[me.role]}
            </span>
          ) : (
            <span className="text-muted-foreground tabular-nums">{online.length}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <UsersIcon className="size-4 text-muted-foreground" /> Team room
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {member
              ? me.role === "viewer"
                ? "You can follow along. Approvals and changes are up to approvers and the owner."
                : "You can approve, answer questions, comment and start goals. Everything runs on the owner's machine."
              : "People connected to your AgentRoom right now."}
          </p>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1.5">
          {online.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-1.5">
              <PersonAvatar name={p.name} email={p.email} active={p.active} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {p.name}
                  {p.id === me.id && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{p.email}</span>
              </span>
              <ToneBadge size="sm" tone={p.role === "owner" ? "brand" : p.role === "approver" ? "info" : "neutral"}>
                {ROLE_LABEL[p.role]}
              </ToneBadge>
            </li>
          ))}
        </ul>
        <div className="flex justify-end border-t px-3 py-2">
          {member ? (
            <Button size="sm" variant="ghost" onClick={leave}>
              <LogOutIcon data-icon="inline-start" /> Leave
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => useAppStore.getState().showSettings("room")}>
              <SettingsIcon data-icon="inline-start" /> Manage room
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Forget this browser's member link (the owner can still revoke it). */
function leave() {
  try {
    sessionStorage.clear()
  } catch {}
  window.location.replace(window.location.pathname)
}

/**
 * Teammates never land on owner-only pages (deep links, ⌘K), and see a clear screen when their
 * access ends instead of a reconnect loop.
 */
export function RoomGuards() {
  const me = useRoomStore((s) => s.me)
  const removed = useRoomStore((s) => s.removed)
  const view = useAppStore((s) => s.view)
  const member = isMember(me)

  useEffect(() => {
    if (member && OWNER_ONLY_VIEWS.has(view)) useAppStore.getState().setView(View.Team)
  }, [member, view])

  if (!removed) return null
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/95 p-6 backdrop-blur-sm" role="alertdialog" aria-labelledby="room-removed-title">
      <div className={cn("w-full max-w-sm space-y-3 rounded-2xl border bg-card p-6 text-center shadow-lg")}>
        <span className="mx-auto grid size-10 place-items-center rounded-full border bg-sunken">
          <UsersIcon className="size-5 text-muted-foreground" />
        </span>
        <h2 id="room-removed-title" className="text-base font-semibold tracking-tight">
          Your access to this room ended
        </h2>
        <p className="text-sm text-muted-foreground">The link was revoked, replaced or expired, or the owner stopped sharing. Ask them for a new link.</p>
        <Button variant="outline" onClick={leave}>
          Close
        </Button>
      </div>
    </div>
  )
}
