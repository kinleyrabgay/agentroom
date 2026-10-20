import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleOffIcon, KeyRoundIcon, LoaderCircleIcon, LogInIcon, type LucideIcon } from "lucide-react"
import { McpStatus, type McpServerState } from "@shared"
import type { Tone } from "@/components/kit/tone"

/** Label, icon and tone per connection status. `action`: the server needs the human. */
export const STATUS_META: Record<McpStatus, { label: string; icon: LucideIcon; tone: Tone; action?: boolean; spin?: boolean }> = {
  [McpStatus.Connected]: { label: "Connected", icon: CircleCheckIcon, tone: "success" },
  [McpStatus.NeedsAuth]: { label: "Needs sign-in", icon: LogInIcon, tone: "warning", action: true },
  [McpStatus.MissingSecret]: { label: "Needs a token", icon: KeyRoundIcon, tone: "warning", action: true },
  [McpStatus.Failed]: { label: "Can't connect", icon: CircleAlertIcon, tone: "danger", action: true },
  [McpStatus.Pending]: { label: "Connecting", icon: LoaderCircleIcon, tone: "neutral", spin: true },
  [McpStatus.Unknown]: { label: "Not checked", icon: CircleDashedIcon, tone: "neutral" },
  [McpStatus.Disabled]: { label: "Off", icon: CircleOffIcon, tone: "neutral" },
}

/** Enabled servers that need the human (sign in, token, or broken). */
export const needsAction = (s: McpServerState) => s.enabled && !!STATUS_META[s.status].action

/** Where a Claude Code server comes from, in words. */
export function sourceLabel(source: string) {
  if (source.startsWith("workspace:")) return `Workspace repo ${source.slice("workspace:".length)} (its .agentroom/mcp.json)`
  switch (source) {
    case "claudeai":
      return "claude.ai"
    case "user":
      return "Your Claude Code"
    case "project":
      return "This repo (.mcp.json)"
    case "local":
      return "This repo (local)"
    case "plugin":
      return "Plugin"
    default:
      return source
  }
}

/** One-line description of how a server is reached. */
export function endpoint(s: Pick<McpServerState, "config">) {
  const c = s.config
  if (c.type === "stdio") return [c.command, ...(c.args ?? [])].join(" ")
  return c.url
}
