import {
  CalendarClockIcon,
  BugIcon,
  ChartNoAxesColumnIcon,
  GlobeIcon,
  InboxIcon,
  NetworkIcon,
  PlugIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldIcon,
  SquareKanbanIcon,
  WaypointsIcon,
} from "lucide-react"
import type { ComponentType } from "react"
import { GithubMark } from "@/components/kit/brand-icons"
import { View } from "./constants"

/** Name, one-line description and icon of every view. Sidebar, top bar, ⌘K and error screens read this. */
export const VIEW_META: Record<View, { label: string; description: string; icon: ComponentType<{ className?: string }> }> = {
  [View.Team]: { label: "Team", description: "Your bots at work. Click one to talk, drop skills on it.", icon: NetworkIcon },
  [View.Inbox]: { label: "Inbox", description: "Everything waiting on you, in one place.", icon: InboxIcon },
  [View.Context]: { label: "Context", description: "The map bots read: modules, cards, and what depends on what.", icon: WaypointsIcon },
  [View.Automation]: { label: "Automation", description: "Schedules and triggers that run the team without you.", icon: CalendarClockIcon },
  [View.Work]: { label: "Work", description: "Goals and their tasks: plan, build, test, report.", icon: SquareKanbanIcon },
  [View.Github]: { label: "GitHub", description: "Your project board. Pick cards and hand them to the team.", icon: GithubMark },
  [View.Sentry]: { label: "Sentry", description: "Production errors. Read the trace, hand one to a bot to fix.", icon: BugIcon },
  [View.Browser]: { label: "Browser", description: "Your app, live. Bots browse it; you can take over.", icon: GlobeIcon },
  [View.Security]: { label: "Security", description: "Scanner findings, dependency checks and reviews.", icon: ShieldIcon },
  [View.Audit]: { label: "Audit log", description: "Every command, write, push and approval, and who decided.", icon: ScrollTextIcon },
  [View.Insights]: { label: "Insights", description: "How the team is doing: results, spend and where runs fail.", icon: ChartNoAxesColumnIcon },
  [View.Connections]: { label: "MCP servers", description: "External tools your bots can use.", icon: PlugIcon },
  [View.Settings]: { label: "Settings", description: "Team defaults, alerts and integrations.", icon: SettingsIcon },
}
