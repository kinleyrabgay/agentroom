"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import {
  MoonIcon,
  OctagonXIcon,
  PlugIcon,
  SquareKanbanIcon,
  SunIcon, CalendarClockIcon, ZapIcon, BoxIcon, EyeIcon, FileCodeIcon, MessageSquareIcon, RefreshCwIcon, SquareFunctionIcon, MapIcon, FileTextIcon, MessageSquareTextIcon } from "lucide-react"
import { ClientMessageType, GoalStatus, type ContextHit } from "@shared"
import { BotTab, View } from "@/lib/constants"
import { VIEW_META } from "@/lib/views"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { openSchedule, openTrigger } from "@/features/automation/lib/ui-store"
import { contextApi } from "@/lib/api/endpoints"
import { askAbout, loadGraph, openModule, setContext, setContextTab, useContextStore } from "@/features/context/lib/context-store"
import { openHit } from "@/features/context/components/context-search"
import { startSync } from "@/features/context/lib/actions"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { ToneDot } from "@/components/kit/badge"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"

/** Pages in palette order. */
const PAGES: View[] = [
  View.Team,
  View.Inbox,
  View.Work,
  View.Context,
  View.Automation,
  View.Github,
  View.Sentry,
  View.Browser,
  View.Security,
  View.Audit,
  View.Insights,
  View.Settings,
]
const OPEN_GOALS = new Set<string>([
  GoalStatus.Planning,
  GoalStatus.AwaitingApproval,
  GoalStatus.Building,
  GoalStatus.Securing,
  GoalStatus.Testing,
  GoalStatus.Verifying,
  GoalStatus.Reporting,
  GoalStatus.Paused,
])

/** ⌘K: jump to any page, bot or goal, and run common actions. */
export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen)
  const setOpen = useAppStore((s) => s.setPaletteOpen)
  const bots = useAppStore((s) => s.bots)
  const goals = useAppStore((s) => s.goals)
  const { resolvedTheme, setTheme } = useTheme()
  const ctx = useContextStore((s) => s.status)
  const modules = useContextStore((s) => s.graph?.modules)
  const openModuleId = useContextStore((s) => s.openModuleId)
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<{ q: string; list: ContextHit[] }>({ q: "", list: [] })
  const codeReady = !!ctx?.enabled && !!ctx.built

  // Modules come from the map; load it the first time the palette opens.
  useEffect(() => {
    if (open && codeReady && !useContextStore.getState().graph) void loadGraph()
  }, [open, codeReady])
  // Symbols and files: the same search bots use, once the query is specific enough.
  useEffect(() => {
    const query = q.trim()
    if (!open || !codeReady || query.length < 3) return
    let live = true
    const t = setTimeout(() => {
      contextApi
        .find(query, 8)
        .then((list) => live && setHits({ q: query, list: list.filter((h) => h.kind !== "module") }))
        .catch(() => {})
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, open, codeReady])
  const codeHits = hits.q === q.trim() ? hits.list : []
  const openMod = openModuleId ? modules?.find((m) => m.id === openModuleId) : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(!useAppStore.getState().paletteOpen)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen])

  const run = (fn: () => void) => {
    setOpen(false)
    setQ("")
    fn()
  }
  const showModule = (id: string) => {
    app().setView(View.Context)
    openModule(id)
  }
  const app = useAppStore.getState

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search AgentRoom"
      description="Jump to a page, bot or goal, or run a command."
      className="sm:max-w-xl"
    >
      <Command>
        <CommandInput value={q} onValueChange={setQ} placeholder="Search pages, bots, goals, modules, code…" />
        <CommandList className="max-h-[min(60vh,440px)]">
          <CommandEmpty>Nothing matches.</CommandEmpty>

          <CommandGroup heading="Go to">
            {PAGES.map((v) => {
              const { label, icon: Icon, description } = VIEW_META[v]
              return (
                <CommandItem
                  key={v}
                  value={`go ${label} ${description}`}
                  onSelect={() => run(() => app().setView(v))}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span>{label}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">
                    {description}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>

          {bots.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Talk to a bot">
                {bots.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`bot ${b.name} ${b.role} ${b.id}`}
                    onSelect={() => run(() => app().select(b.id, BotTab.Chat))}
                  >
                    <BotAvatar
                      bot={b}
                      showStatus
                      className="size-5 rounded-md text-xs"
                    />
                    <span>{b.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.role}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {goals.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Goals">
                {[...goals]
                  .reverse()
                  .slice(0, 12)
                  .map((g) => (
                    <CommandItem
                      key={g.id}
                      value={`goal ${g.id} ${g.title}`}
                      onSelect={() =>
                        run(() => app().showOnTasks({ goalId: g.id }))
                      }
                    >
                      <ToneDot
                        tone={
                          g.status === GoalStatus.AwaitingApproval ||
                          g.status === GoalStatus.Paused
                            ? "warning"
                            : OPEN_GOALS.has(g.status)
                              ? "brand"
                              : g.status === GoalStatus.Done
                                ? "success"
                                : "neutral"
                        }
                      />
                      <span className="font-mono text-xs text-muted-foreground">
                        {g.id}
                      </span>
                      <span className="truncate">{g.title}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </>
          )}

          {codeHits.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Code">
                {codeHits.map((h) => (
                  <CommandItem
                    key={`${h.path}:${h.line ?? ""}:${h.name ?? ""}`}
                    value={`code ${q} ${h.path} ${h.name ?? ""} ${h.line ?? ""}`}
                    onSelect={() =>
                      run(() => {
                        app().setView(View.Context)
                        openHit(h)
                      })
                    }
                  >
                    {h.kind === "symbol" ? <SquareFunctionIcon className="size-4 text-muted-foreground" /> : <FileCodeIcon className="size-4 text-muted-foreground" />}
                    <span className="truncate">{h.kind === "symbol" ? h.name : h.path}</span>
                    <span className="ml-2 truncate font-mono text-xs text-muted-foreground">{h.kind === "symbol" ? `${h.path}:${h.line}` : h.detail}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {modules && modules.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Modules">
                {modules.map((m) => (
                  <CommandItem key={m.id} value={`module ${m.id} ${m.dir} ${m.purpose}`} onSelect={() => run(() => showModule(m.id))}>
                    <BoxIcon className="size-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{m.id}</span>
                    <span className="ml-2 truncate text-xs text-muted-foreground">{m.purpose}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {openMod && bots.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`Ask about ${openMod.id}`}>
                {bots.slice(0, 8).map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`ask bot about this module ${openMod.id} ${b.name}`}
                    onSelect={() => run(() => app().draftToBot(b.id, `Using context module ${openMod.id}: `))}
                  >
                    <MessageSquareIcon className="size-4 text-muted-foreground" /> Ask {b.name} about this module
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator />
          <CommandGroup heading="Commands">
            <CommandItem
              value="new goal give the team a goal"
              onSelect={() => run(() => app().setView(View.Work))}
            >
              <SquareKanbanIcon className="size-4 text-muted-foreground" /> New
              goal
            </CommandItem>
            <CommandItem
              value="new schedule schedule later tomorrow every day automation"
              onSelect={() =>
                run(() => {
                  app().setView(View.Automation)
                  openSchedule()
                })
              }
            >
              <CalendarClockIcon className="size-4 text-muted-foreground" /> New schedule
            </CommandItem>
            <CommandItem
              value="new trigger when sentry github automation"
              onSelect={() =>
                run(() => {
                  app().setView(View.Automation)
                  openTrigger()
                })
              }
            >
              <ZapIcon className="size-4 text-muted-foreground" /> New trigger
            </CommandItem>
            {codeReady && (
              <CommandItem value="sync repo context map cards" onSelect={() => run(() => startSync({}))}>
                <RefreshCwIcon className="size-4 text-muted-foreground" /> Sync repo context
              </CommandItem>
            )}
            {codeReady && (
              <CommandItem
                value="what bots see repo map index context"
                onSelect={() =>
                  run(() => {
                    app().setView(View.Context)
                    setContext({ indexOpen: true })
                  })
                }
              >
                <EyeIcon className="size-4 text-muted-foreground" /> What bots see
              </CommandItem>
            )}
            {codeReady && (
              <CommandItem
                value={`ask the codebase question ${q}`}
                onSelect={() =>
                  run(() => {
                    app().setView(View.Context)
                    askAbout(q.trim().length > 3 ? q.trim() : "")
                  })
                }
              >
                <MessageSquareTextIcon className="size-4 text-muted-foreground" />
                <span className="truncate">{q.trim().length > 3 ? `Ask the codebase: “${q.trim()}”` : "Ask the codebase…"}</span>
              </CommandItem>
            )}
            {codeReady && (
              <CommandItem
                value="onboarding tour learn codebase modules"
                onSelect={() =>
                  run(() => {
                    app().setView(View.Context)
                    setContextTab("tour")
                  })
                }
              >
                <MapIcon className="size-4 text-muted-foreground" /> Onboarding tour
              </CommandItem>
            )}
            {codeReady && (
              <CommandItem
                value="generate architecture docs decisions diagram"
                onSelect={() =>
                  run(() => {
                    app().setView(View.Context)
                    setContextTab("docs")
                  })
                }
              >
                <FileTextIcon className="size-4 text-muted-foreground" /> Architecture docs
              </CommandItem>
            )}
            <CommandItem
              value="integrations connections mcp github sentry"
              onSelect={() => run(() => app().showSettings("integrations"))}
            >
              <PlugIcon className="size-4 text-muted-foreground" /> Integrations
            </CommandItem>
            <CommandItem
              value="toggle theme dark light"
              onSelect={() =>
                run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
              }
            >
              {resolvedTheme === "dark" ? (
                <SunIcon className="size-4 text-muted-foreground" />
              ) : (
                <MoonIcon className="size-4 text-muted-foreground" />
              )}
              {resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
              <CommandShortcut>D</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="stop all bots"
              onSelect={() => run(() => send({ type: ClientMessageType.Stop }))}
            >
              <OctagonXIcon className="size-4 text-danger" /> Stop all bots
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
