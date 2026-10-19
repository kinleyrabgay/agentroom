"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import {
  MoonIcon,
  OctagonXIcon,
  PlugIcon,
  SquareKanbanIcon,
  SunIcon, CalendarClockIcon, ZapIcon } from "lucide-react"
import { ClientMessageType, GoalStatus } from "@shared"
import { BotTab, View } from "@/lib/constants"
import { VIEW_META } from "@/lib/views"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { openSchedule, openTrigger } from "@/features/automation/lib/ui-store"
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
    fn()
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
        <CommandInput placeholder="Search pages, bots, goals, commands…" />
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
