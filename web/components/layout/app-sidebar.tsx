"use client"

import { useTheme } from "next-themes"
import { GitBranchIcon, GlobeIcon, ListChecksIcon, MoonIcon, NetworkIcon, ScrollTextIcon, SettingsIcon, ShieldIcon, SquareKanbanIcon, SunIcon, type LucideIcon } from "lucide-react"
import { APP_NAME, BotStatus, GoalStatus, TaskStatus } from "@shared"
import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
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

export function AppSidebar() {
  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader>
        <ProjectHeader />
      </SidebarHeader>
      <SidebarContent>
        <ErrorBoundary label="Workspace" compact>
          <WorkspaceNav />
        </ErrorBoundary>
        <ErrorBoundary label="Governance" compact>
          <GovernanceNav />
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
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent active:bg-transparent">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-base text-primary-foreground">🧭</div>
          <div className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate font-semibold">{APP_NAME}</span>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              {info?.name ?? "…"}
              {info?.branch && (
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

function WorkspaceNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const openTasks = useAppStore((s) => s.tasks.filter((t) => t.status !== TaskStatus.Done).length)
  const openPages = useAppStore((s) => Object.keys(s.previews).length)
  const myCards = useGithubStore((s) => myOpenCount(s.board?.items, s.board?.viewer))
  const needsReview = useAppStore((s) => s.goals.some((g) => g.status === GoalStatus.AwaitingApproval))

  const items: NavItem[] = [
    { view: View.Team, label: "Team", icon: NetworkIcon },
    { view: View.Board, label: "Board", icon: SquareKanbanIcon, badge: myCards },
    { view: View.Tasks, label: "Tasks", icon: ListChecksIcon, badge: openTasks, alert: needsReview && "a plan needs your review" },
    { view: View.Browser, label: "Browser", icon: GlobeIcon, badge: openPages },
  ]

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarGroupContent>
        <NavItems items={items} active={view} onSelect={setView} />
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Oversight of what the bots did. */
function GovernanceNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const { openCritical, openWarning } = useFindingCounts()
  const items: NavItem[] = [
    {
      view: View.Security,
      label: "Security",
      icon: ShieldIcon,
      // Red for open critical findings; amber when only warnings are open.
      badge: openCritical || openWarning,
      badgeClassName: openCritical
        ? "bg-red-500/15 text-red-700 dark:text-red-300"
        : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      badgeLabel: openCritical ? `${openCritical} open critical` : `${openWarning} open warnings`,
    },
    { view: View.Audit, label: "Audit log", icon: ScrollTextIcon },
  ]
  return (
    <CollapsibleSidebarGroup id="governance" label="Governance">
      <SidebarGroupContent>
        <NavItems items={items} active={view} onSelect={setView} />
      </SidebarGroupContent>
    </CollapsibleSidebarGroup>
  )
}

function SettingsNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  return <NavItems items={[{ view: View.Settings, label: "Settings", icon: SettingsIcon }]} active={view} onSelect={setView} />
}

interface NavItem {
  view: View
  label: string
  icon: LucideIcon
  badge?: number
  /** Overrides the badge's neutral look (e.g. severity colors). */
  badgeClassName?: string
  /** Accessible description of the badge. */
  badgeLabel?: string
  /** Amber dot with this reason in the tooltip. */
  alert?: string | false
}

function NavItems({ items, active, onSelect }: { items: NavItem[]; active: View; onSelect: (v: View) => void }) {
  return (
    <SidebarMenu>
      {items.map(({ view: v, label, icon: Icon, badge = 0, badgeClassName, badgeLabel, alert }) => (
        <SidebarMenuItem key={v}>
          <SidebarMenuButton isActive={active === v} onClick={() => onSelect(v)} tooltip={alert ? `${label} — ${alert}` : label}>
            <span className="relative">
              <Icon className="size-4" />
              {alert && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-sidebar" />}
            </span>
            <span>{label}</span>
          </SidebarMenuButton>
          {badge > 0 && (
            <SidebarMenuBadge className={cn(badgeClassName && "rounded-full px-1.5", badgeClassName)} aria-label={badgeLabel} title={badgeLabel}>
              {badge}
            </SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      ))}
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
                    <span className="truncate text-[11px] text-muted-foreground">{active ? (st.activity ?? st.status) : b.role}</span>
                  </div>
                </SidebarMenuButton>
                {previews[b.id] && (
                  <SidebarMenuBadge>
                    <GlobeIcon className="size-3.5 text-sky-500" />
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
            <span className={`size-2 rounded-full ${connected ? "bg-emerald-500" : "animate-pulse bg-destructive"}`} />
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
        title="Toggle theme"
      >
        {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
    </div>
  )
}
