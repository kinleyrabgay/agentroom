"use client"

import { useTheme } from "next-themes"
import { useContextStore } from "@/features/context/lib/context-store"
import { useSentryStore } from "@/features/sentry/lib/sentry-store"
import { GitBranchIcon, GlobeIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react"
import { APP_NAME, BotStatus, TaskStatus } from "@shared"
import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { VIEW_META } from "@/lib/views"
import { useNeedsYou } from "@/hooks/use-needs-you"
import { LogoMark } from "@/components/kit/logo"
import { ToneDot } from "@/components/kit/badge"
import { TONE_CLASS, type Tone } from "@/components/kit/tone"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { CollapsibleSidebarGroup } from "@/components/shared/collapsible-sidebar-group"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { SkillLibrary } from "@/features/skills/components/skill-library"
import { useGithubStore } from "@/features/github/lib/github-store"
import { myOpenCount } from "@/features/github/lib/board-view"
import { useFindingCounts } from "@/features/security/hooks/use-finding-counts"
import { cn } from "@/lib/utils"
import { RepoSwitcher } from "@/features/workspaces/components/repo-switcher"
import { useWorkspaceStore } from "@/features/workspaces/lib/workspace-store"

export function AppSidebar() {
  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="gap-2">
        <ProjectHeader />
        {/* Multi-repo workspaces: which repo the board and map show (renders nothing outside a workspace). */}
        <ErrorBoundary label="Repo" compact fallback={null}>
          <RepoSwitcher className="w-full max-w-none group-data-[collapsible=icon]:hidden [&>svg:last-child]:ml-auto" />
        </ErrorBoundary>
        <SearchButton />
      </SidebarHeader>
      <SidebarContent>
        <ErrorBoundary label="Navigation" compact>
          <PrimaryNav />
          <SourcesNav />
          <OversightNav />
        </ErrorBoundary>
        <BotList />
        <SkillLibrary />
      </SidebarContent>
      <SidebarFooter>
        <SettingsNav />
        <FooterStatus />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function ProjectHeader() {
  const info = useAppStore((s) => s.info)
  const workspace = useWorkspaceStore((s) => s.workspace)
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent active:bg-transparent">
          <LogoMark />
          <div className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate font-semibold tracking-tight">{APP_NAME}</span>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              {workspace ? (
                <span className="truncate">
                  Workspace {workspace.name} · {workspace.repos.length} repos
                </span>
              ) : (
                (info?.name ?? "…")
              )}
              {!workspace && info?.branch && (
                <>
                  <GitBranchIcon className="size-3" />
                  <span className="truncate font-mono">{info.branch}</span>
                </>
              )}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** Search and commands. Opens the ⌘K palette. */
function SearchButton() {
  const setPalette = useAppStore((s) => s.setPaletteOpen)
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => setPalette(true)}
          tooltip="Search  ⌘K"
          className="h-8 border bg-sidebar text-muted-foreground shadow-xs hover:text-foreground"
        >
          <SearchIcon className="size-4" />
          <span>Search</span>
          <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">⌘K</Kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** Where you spend the day: the team, what needs you, the work. */
function PrimaryNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const needs = useNeedsYou()
  const openTasks = useAppStore((s) => s.tasks.filter((t) => t.status !== TaskStatus.Done).length)
  const failedRuns = useAppStore((s) => s.automation?.failedSinceSeen ?? 0)
  const staleCards = useContextStore((s) => (s.status?.enabled ? s.status.cards.stale : 0))
  const items: NavItem[] = [
    { view: View.Team, badge: 0 },
    { view: View.Inbox, badge: needs.total, tone: "warning", badgeLabel: `${needs.total} waiting on you` },
    { view: View.Work, badge: openTasks, badgeLabel: `${openTasks} open tasks`, alert: needs.plans > 0 && "a plan needs your review" },
    { view: View.Context, badge: 0, alert: staleCards > 0 && `${staleCards} module ${staleCards === 1 ? "card is" : "cards are"} out of date` },
    { view: View.Automation, badge: failedRuns, tone: "danger", badgeLabel: `${failedRuns} automation ${failedRuns === 1 ? "run" : "runs"} failed` },
  ]
  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupContent>
        <NavItems items={items} active={view} onSelect={setView} />
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Where work comes from. */
function SourcesNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const openPages = useAppStore((s) => Object.keys(s.previews).length)
  const myCards = useGithubStore((s) => myOpenCount(s.board?.items, s.board?.viewer))
  // New or regressed issues in the list the Sentry page last loaded.
  const freshIssues = useSentryStore((s) => s.issues.filter((i) => i.substatus === "new" || i.substatus === "regressed").length)
  const items: NavItem[] = [
    { view: View.Github, badge: myCards, badgeLabel: `${myCards} open cards assigned to you` },
    { view: View.Sentry, badge: freshIssues, tone: "danger", badgeLabel: `${freshIssues} new or regressed ${freshIssues === 1 ? "issue" : "issues"}` },
    { view: View.Browser, badge: openPages, badgeLabel: `${openPages} open pages` },
  ]
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Sources</SidebarGroupLabel>
      <SidebarGroupContent>
        <NavItems items={items} active={view} onSelect={setView} />
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** What the bots did. */
function OversightNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const { openCritical, openWarning } = useFindingCounts()
  const items: NavItem[] = [
    {
      view: View.Security,
      badge: openCritical || openWarning,
      tone: openCritical ? "danger" : "warning",
      badgeLabel: openCritical ? `${openCritical} open critical` : `${openWarning} open warnings`,
    },
    { view: View.Audit },
    { view: View.Insights },
  ]
  return (
    <CollapsibleSidebarGroup id="governance" label="Oversight">
      <SidebarGroupContent>
        <NavItems items={items} active={view} onSelect={setView} />
      </SidebarGroupContent>
    </CollapsibleSidebarGroup>
  )
}

function SettingsNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const { connections } = useNeedsYou()
  const items: NavItem[] = [
    {
      view: View.Settings,
      badge: connections,
      tone: "warning",
      badgeLabel: `${connections} ${connections === 1 ? "integration needs" : "integrations need"} you`,
    },
  ]
  return <NavItems items={items} active={view === View.Connections ? View.Settings : view} onSelect={setView} />
}

interface NavItem {
  view: View
  badge?: number
  /** Badge tone; neutral counts stay quiet. */
  tone?: Tone
  /** Accessible description of the badge. */
  badgeLabel?: string
  /** Small warning dot with this reason in the tooltip. */
  alert?: string | false
}

function NavItems({ items, active, onSelect }: { items: NavItem[]; active: View; onSelect: (v: View) => void }) {
  return (
    <SidebarMenu>
      {items.map(({ view: v, badge = 0, tone, badgeLabel, alert }) => {
        const { label, icon: Icon } = VIEW_META[v]
        const on = active === v
        return (
          <SidebarMenuItem key={v}>
            <SidebarMenuButton
              isActive={on}
              onClick={() => onSelect(v)}
              tooltip={alert ? `${label}: ${alert}` : label}
              aria-current={on ? "page" : undefined}
              className="data-[active=true]:font-medium"
            >
              <span className="relative">
                <Icon className={cn("size-4", on && "text-brand")} />
                {alert && <ToneDot tone="warning" className="absolute -top-1 -right-1 size-2 ring-2 ring-sidebar" />}
              </span>
              <span>{label}</span>
            </SidebarMenuButton>
            {badge > 0 && (
              <SidebarMenuBadge
                aria-label={badgeLabel}
                title={badgeLabel}
                className={cn(
                  "rounded-full px-1.5 tabular-nums",
                  tone ? cn(TONE_CLASS[tone], "tone-soft border") : "text-muted-foreground"
                )}
              >
                {badge}
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

function BotList() {
  const bots = useAppStore((s) => s.bots)
  const statuses = useAppStore((s) => s.statuses)
  const previews = useAppStore((s) => s.previews)
  const selected = useAppStore((s) => s.selectedBot)
  const select = useAppStore((s) => s.select)

  return (
    <CollapsibleSidebarGroup id="bots" label="Bots">
      <SidebarGroupContent>
        <SidebarMenu>
          {bots.map((b) => {
            const st = statuses[b.id]
            const active = st && st.status !== BotStatus.Idle
            return (
              <SidebarMenuItem key={b.id}>
                <SidebarMenuButton
                  isActive={selected === b.id}
                  onClick={() => select(b.id)}
                  tooltip={`${b.name}${active ? ` — ${st.activity ?? st.status}` : ""}`}
                  className="h-auto py-1.5"
                >
                  <BotAvatar bot={b} showStatus className="size-6 rounded-md text-sm" />
                  <div className="grid min-w-0 leading-tight">
                    <span className="truncate">{b.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{active ? (st.activity ?? st.status) : b.role}</span>
                  </div>
                </SidebarMenuButton>
                {previews[b.id] && (
                  <SidebarMenuBadge>
                    <GlobeIcon className="size-3.5 text-info" />
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </CollapsibleSidebarGroup>
  )
}

function FooterStatus() {
  const connected = useAppStore((s) => s.connected)
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5">
            <ToneDot tone={connected ? "success" : "danger"} pulse={!connected} />
            <span className="group-data-[collapsible=icon]:hidden">{connected ? "Live" : "Reconnecting"}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{connected ? "Connected to the AgentRoom server" : "Server unreachable — retrying"}</TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto group-data-[collapsible=icon]:ml-0"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        aria-label={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      >
        {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
    </div>
  )
}
