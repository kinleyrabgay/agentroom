"use client"

import { useMemo, useState } from "react"
import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, PlugIcon, PlusIcon, RotateCwIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"
import { McpStatus, type McpAvailable } from "@shared"
import { cn } from "@/lib/utils"
import { mcpApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/kit/callout"
import { ToneDot } from "@/components/kit/badge"
import { EmptyState } from "@/components/kit/state-view"
import { needsAction, sourceLabel, STATUS_META } from "../lib/meta"
import { AddServerDialog } from "./add-server-dialog"
import { ServerCard } from "./server-card"
import { StatusBadge } from "./status-badge"

/** The MCP servers view (`#/connections`): the same section Settings → Integrations shows. */
export function ConnectionsPage() {
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-5 pb-24">
        <McpServersSection />
      </div>
    </div>
  )
}

/** MCP servers: what the bots can reach, what needs you, and what's already set up in Claude Code. */
export function McpServersSection() {
  const mcp = useAppStore((s) => s.mcp)
  const [adding, setAdding] = useState<{ preset?: string } | null>(null)
  const servers = mcp?.servers
  const attention = useMemo(() => servers?.filter(needsAction) ?? [], [servers])
  const refresh = () => mcpApi.refresh().catch((e) => toast.error((e as Error).message))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">Bots only get the servers listed here, never everything set up in Claude Code.</p>
        <span className="text-xs text-muted-foreground">
          {mcp?.checking ? "Checking…" : mcp?.checkedAt ? `Checked ${timeAgo(Date.parse(mcp.checkedAt))}` : ""}
        </span>
        <Button variant="outline" size="sm" onClick={refresh} disabled={!mcp || mcp.checking}>
          <RotateCwIcon className={cn(mcp?.checking && "animate-spin")} data-icon="inline-start" /> Refresh
        </Button>
        <Button size="sm" onClick={() => setAdding({})}>
          <PlusIcon data-icon="inline-start" /> Add server
        </Button>
      </div>

      {attention.length > 0 && (
        <Callout tone="warning" title={attention.length === 1 ? `${attention[0]!.name}: ${STATUS_META[attention[0]!.status].label.toLowerCase()}` : `${attention.length} servers need you`}>
          Until then, bots run without {attention.length === 1 ? "it" : "them"}.
        </Callout>
      )}

      <div className="space-y-3">
        {!mcp ? (
          <>
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </>
        ) : mcp.servers.length ? (
          mcp.servers.map((s) => <ServerCard key={s.name} server={s} signingIn={mcp.signingIn === s.name} />)
        ) : (
          <EmptyServers onAdd={(preset) => setAdding({ preset })} />
        )}
        {mcp && mcp.servers.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheckIcon className="mt-px size-3.5 shrink-0" />
            Read-only tools run without asking. Everything else waits for your approval, and every call is in the Audit log. Results are treated as
            untrusted data.
          </p>
        )}
      </div>

      {mcp && <FoundInClaudeCode available={mcp.available} checking={mcp.checking} />}
      <AddServerDialog open={!!adding} onOpenChange={(v) => !v && setAdding(null)} initial={adding?.preset} />
    </div>
  )
}

function EmptyServers({ onAdd }: { onAdd: (preset?: string) => void }) {
  return (
    <EmptyState
      compact
      icon={PlugIcon}
      title="No MCP servers yet"
      description="Connect Sentry so the Developer can read the real errors and stack traces behind a bug, or add any MCP server."
      className="rounded-xl border border-dashed"
      action={
        <>
          <Button size="sm" onClick={() => onAdd("sentry")}>
            <PlusIcon data-icon="inline-start" /> Connect Sentry
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd()}>
            Other server
          </Button>
        </>
      }
    />
  )
}

/** Servers set up in Claude Code (claude.ai connectors, user/project config, plugins). Bots don't get them unless added. */
function FoundInClaudeCode({ available, checking }: { available: McpAvailable[]; checking: boolean }) {
  const groups = useMemo(() => {
    const m = new Map<string, McpAvailable[]>()
    for (const a of available) m.set(a.source, [...(m.get(a.source) ?? []), a])
    // The workspace's other repos first: their team set these up for this code.
    const fromRepo = (source: string) => (source.startsWith("workspace:") ? 0 : 1)
    return [...m.entries()].sort(([a], [b]) => fromRepo(a) - fromRepo(b))
  }, [available])
  const connected = available.filter((a) => a.status === McpStatus.Connected).length

  return (
    <Collapsible defaultOpen={available.some((a) => a.repo && !a.added)} className="rounded-xl border bg-card">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="font-medium">{available.some((a) => a.repo) ? "Found in Claude Code and other repos" : "Found in Claude Code"}</span>
        <span className="text-xs text-muted-foreground">
          {checking && !available.length ? "looking…" : `${available.length} servers · ${connected} connected`}
        </span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">Not given to bots unless you add them</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {!available.length ? (
          <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
            {checking ? "Looking for servers…" : "No MCP servers set up in Claude Code for this repo."}
          </p>
        ) : (
          groups.map(([source, list]) => (
            <div key={source} className="border-t">
              <p className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{sourceLabel(source)}</p>
              <ul>
                {list.map((a) => (
                  <AvailableRow key={a.name} a={a} />
                ))}
              </ul>
            </div>
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function AvailableRow({ a }: { a: McpAvailable }) {
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try {
      const e = await mcpApi.import(a.name)
      toast.success(`Added as ${e.name}`, { description: a.repo ? "Personal to you. Set any secrets it needs, then it starts." : "Personal to you. Share it with the team from its menu." })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const label = a.name.replace(/^claude\.ai\s+/, "").replace(/^plugin:/, "")

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <ToneDot tone={STATUS_META[a.status].tone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        {a.url && <span className="block truncate font-mono text-xs text-muted-foreground">{a.url}</span>}
        {/* From another repo of the workspace: show what it would run before anyone adds it. */}
        {a.command && <span className="block truncate font-mono text-xs text-muted-foreground" title={a.command}>{a.command}</span>}
      </span>
      {a.status !== McpStatus.Connected && !a.repo && <StatusBadge status={a.status} className="hidden sm:inline-flex" />}
      {a.status === McpStatus.Connected && <span className="text-xs text-muted-foreground">{a.toolCount} tools</span>}
      {a.added ? (
        <span className="inline-flex items-center gap-1 text-xs tone-success tone-text">
          <CheckIcon className="size-3.5" /> Added
        </span>
      ) : a.source === "claudeai" && a.status === McpStatus.NeedsAuth ? (
        <Button size="xs" variant="ghost" asChild>
          <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer">
            Connect <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </Button>
      ) : (
        <Button size="xs" variant="outline" onClick={add} disabled={busy}>
          Add
        </Button>
      )}
    </li>
  )
}
