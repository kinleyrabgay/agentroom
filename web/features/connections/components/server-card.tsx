"use client"

import { useState } from "react"
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  EyeIcon,
  KeyRoundIcon,
  Loader2Icon,
  LogInIcon,
  MoreHorizontalIcon,
  RotateCwIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"
import { MCP_ALL_BOTS, McpScope, McpStatus, type McpServerState } from "@shared"
import { cn } from "@/lib/utils"
import { TONE_CLASS } from "@/components/kit/tone"
import { mcpApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { signIn } from "../lib/actions"
import { endpoint } from "../lib/meta"
import { usePresets } from "../lib/use-presets"
import { StatusBadge } from "./status-badge"

/** One MCP server AgentRoom gives its bots: status, what to do about it, tools, and which bots get it. */
export function ServerCard({ server: s, signingIn }: { server: McpServerState; signingIn: boolean }) {
  const [confirm, setConfirm] = useState(false)
  const run = (p: Promise<unknown>) => p.catch((e) => toast.error((e as Error).message))
  const team = s.scope === McpScope.Team

  return (
    <div className={cn("rounded-xl border bg-card transition-opacity", !s.enabled && "opacity-70")}>
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted font-mono text-sm font-semibold uppercase">
          {s.name.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{s.name}</span>
            <StatusBadge status={s.status} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-1 text-xs font-normal">
                  {team ? <UsersIcon className="size-3" /> : <UserIcon className="size-3" />}
                  {team ? "Team" : "Personal"}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {team ? "In .agentroom/mcp.json (committed): everyone on the team gets it." : "Only on this machine (.agentroom/runs/mcp.local.json)."}
              </TooltipContent>
            </Tooltip>
          </div>
          {s.description && <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>}
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={endpoint(s)}>
            {s.config.type === "claudeai-proxy" ? "claude.ai connector" : endpoint(s)}
          </p>
        </div>
        <Switch
          checked={s.enabled}
          onCheckedChange={(enabled) => run(mcpApi.update(s.name, { enabled }))}
          aria-label={s.enabled ? `Turn off ${s.name}` : `Turn on ${s.name}`}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More for ${s.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {s.config.type !== "claudeai-proxy" && (
              <DropdownMenuItem onSelect={() => run(mcpApi.update(s.name, { scope: team ? McpScope.Personal : McpScope.Team }))}>
                {team ? <UserIcon /> : <UsersIcon />}
                {team ? "Make personal (only me)" : "Share with the team"}
              </DropdownMenuItem>
            )}
            {s.config.type !== "claudeai-proxy" && s.config.type !== "stdio" && (
              <DropdownMenuItem onSelect={() => signIn(s.name)}>
                <LogInIcon /> Sign in again
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
              <Trash2Icon /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {s.enabled && <NextStep server={s} signingIn={signingIn} />}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3">
        <BotAccess server={s} />
        {s.secrets.length > 0 && s.status !== McpStatus.MissingSecret && <ChangeSecrets server={s} />}
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {s.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Bots lose its tools from their next message. {team ? "It is removed from .agentroom/mcp.json for the whole team." : ""} Stored tokens stay in
              your local secrets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => run(mcpApi.remove(s.name))}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** What the human should do next, or what the server offers when it's connected. */
function NextStep({ server: s, signingIn }: { server: McpServerState; signingIn: boolean }) {
  if (s.status === McpStatus.NeedsAuth) {
    const external = s.config.type === "claudeai-proxy"
    return (
      <CalloutBox tone="warning">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{external ? "Connect it on claude.ai" : `Sign in to ${s.name}`}</p>
          <p className="text-xs opacity-80">
            {signingIn
              ? "Waiting for you to finish in the browser tab…"
              : external
                ? "claude.ai connectors are signed in from your claude.ai settings. Refresh here when done."
                : "Opens the sign-in page in a new tab. Your token is stored by Claude Code, not in the repo."}
          </p>
        </div>
        <Button size="sm" onClick={() => signIn(s.name)} disabled={signingIn}>
          {signingIn ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : external ? <ExternalLinkIcon data-icon="inline-start" /> : <LogInIcon data-icon="inline-start" />}
          {signingIn ? "Waiting…" : external ? "Open claude.ai" : "Sign in"}
        </Button>
      </CalloutBox>
    )
  }
  if (s.status === McpStatus.MissingSecret) return <SecretsForm server={s} names={s.missingSecrets} />
  if (s.status === McpStatus.Failed) {
    return (
      <CalloutBox tone="danger">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Can&apos;t connect</p>
          <p className="font-mono text-xs break-words opacity-80">{s.error ?? "The server didn't start or answer."}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => mcpApi.refresh().catch((e) => toast.error((e as Error).message))}>
          <RotateCwIcon data-icon="inline-start" /> Retry
        </Button>
      </CalloutBox>
    )
  }
  if (s.status === McpStatus.Connected) return <ToolList server={s} />
  return null
}

function CalloutBox({ tone, children }: { tone: "warning" | "danger"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mx-4 mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 text-sm",
        TONE_CLASS[tone],
        "tone-soft [&_p:first-child]:text-foreground"
      )}
    >
      {children}
    </div>
  )
}

function ToolList({ server: s }: { server: McpServerState }) {
  const readOnly = s.tools.filter((t) => t.readOnly).length
  return (
    <Collapsible className="mx-4 mb-4">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {s.tools.length} {s.tools.length === 1 ? "tool" : "tools"}
        {readOnly > 0 && (
          <span>
            · {readOnly} read-only run without asking, the rest wait for your approval
          </span>
        )}
        {s.server && <span className="ml-auto font-mono text-xs">{s.server.name} {s.server.version}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-xl border">
          {s.tools.map((t) => (
            <li key={t.name} className="flex items-start gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs">{t.name}</p>
                {t.description && <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}
              </div>
              {t.readOnly ? (
                <Badge variant="secondary" className="gap-1 text-xs font-normal">
                  <EyeIcon className="size-3" /> read-only
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs font-normal">asks first</Badge>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SecretsForm({ server: s, names, onDone }: { server: McpServerState; names: string[]; onDone?: () => void }) {
  const presets = usePresets()
  const meta = presets.find((p) => p.id === s.preset)?.secrets ?? []
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const ready = names.every((n) => values[n]?.trim())

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mcpApi.setSecrets(s.name, Object.fromEntries(names.map((n) => [n, values[n]!.trim()])))
      toast.success("Saved. Checking the connection…")
      onDone?.()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="tone-warning mx-4 mb-4 space-y-3 rounded-xl border border-[color-mix(in_oklch,var(--tone)_30%,transparent)] bg-[color-mix(in_oklch,var(--tone)_6%,transparent)] p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRoundIcon className="tone-warning tone-text size-4" />
        {onDone ? "Change token" : `${s.name} needs ${names.length === 1 ? "a token" : "tokens"} to start`}
      </p>
      {names.map((n) => {
        const m = meta.find((x) => x.name === n)
        return (
          <div key={n} className="space-y-1">
            <Label htmlFor={`${s.name}-${n}`} className="text-xs">
              {m?.label ?? n} <span className="font-mono font-normal text-muted-foreground">{n}</span>
            </Label>
            <Input
              id={`${s.name}-${n}`}
              type="password"
              autoComplete="off"
              value={values[n] ?? ""}
              onChange={(e) => setValues({ ...values, [n]: e.target.value })}
              className="h-8 font-mono text-xs"
            />
            {(m?.help || m?.url) && (
              <p className="text-xs text-muted-foreground">
                {m?.help}{" "}
                {m?.url && (
                  <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                    Create one <ExternalLinkIcon className="size-3" />
                  </a>
                )}
              </p>
            )}
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={!ready || busy}>
          {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Save
        </Button>
        {onDone && (
          <Button size="sm" type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Stored only on this machine in .agentroom/runs/secrets.json.</span>
      </div>
    </form>
  )
}

function ChangeSecrets({ server: s }: { server: McpServerState }) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <KeyRoundIcon className="size-3" /> Change token
      </button>
    )
  return (
    <div className="-mx-4 -mb-3 basis-full pt-1">
      <SecretsForm server={s} names={s.secrets} onDone={() => setOpen(false)} />
    </div>
  )
}

/** Which bots get the server: everyone, or picked ones. */
function BotAccess({ server: s }: { server: McpServerState }) {
  const bots = useAppStore((st) => st.bots)
  const all = s.bots.includes(MCP_ALL_BOTS)
  const set = (next: string[]) => mcpApi.update(s.name, { bots: next }).catch((e) => toast.error((e as Error).message))
  const toggle = (id: string) => {
    const current = all ? bots.map((b) => b.id) : s.bots
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    if (!next.length) return toast.error("Pick at least one bot, or turn the server off")
    set(next.length === bots.length ? [MCP_ALL_BOTS] : next)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">Bots</span>
      <button
        onClick={() => set([MCP_ALL_BOTS])}
        className={cn(
          "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
          all ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        All
      </button>
      {bots.map((b) => {
        const on = all || s.bots.includes(b.id)
        return (
          <Tooltip key={b.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => toggle(b.id)}
                aria-pressed={on}
                aria-label={`${on ? "Remove" : "Give"} ${s.name} ${on ? "from" : "to"} ${b.name}`}
                className={cn("rounded-full ring-2 ring-offset-1 ring-offset-card transition", on ? "ring-primary/70" : "opacity-40 ring-transparent grayscale hover:opacity-80")}
              >
                <BotAvatar bot={b} className="size-6 rounded-full text-[11px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {b.name}: {on ? "can use it" : "no access"}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
