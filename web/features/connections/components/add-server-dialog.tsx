"use client"

import { useMemo, useState } from "react"
import { ArrowLeftIcon, ExternalLinkIcon, GlobeIcon, Loader2Icon, PlusIcon, TerminalIcon, UserIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"
import { McpScope, type McpPreset, type McpTransportConfig } from "@shared"
import { cn } from "@/lib/utils"
import { mcpApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePresets } from "../lib/use-presets"

type Custom = "http" | "stdio"
type Choice = { preset: McpPreset } | { custom: Custom }

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

/** Pick a ready-made server (Sentry…) or describe your own, then choose who gets it. */
export function AddServerDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (v: boolean) => void; initial?: string }) {
  const presets = usePresets()
  const preset = initial ? presets.find((p) => p.id === initial) : undefined
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <AddServerFlow key={initial ?? "pick"} presets={presets} start={preset ? { preset } : undefined} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function AddServerFlow({ presets, start, onDone }: { presets: McpPreset[]; start?: Choice; onDone: () => void }) {
  const [choice, setChoice] = useState<Choice | undefined>(start)
  if (!choice) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Add an MCP server</DialogTitle>
          <DialogDescription>Give your bots tools from another service. Tools that change something always ask you first.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setChoice({ preset: p })}
              className="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted font-mono text-xs font-semibold uppercase">{p.name.slice(0, 2)}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">{p.description}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{p.auth}</span>
              </span>
            </button>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => setChoice({ custom: "http" })} className="flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted">
              <GlobeIcon className="size-4 text-muted-foreground" /> Custom URL
            </button>
            <button onClick={() => setChoice({ custom: "stdio" })} className="flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted">
              <TerminalIcon className="size-4 text-muted-foreground" /> Custom command
            </button>
          </div>
        </div>
      </>
    )
  }
  return <ServerForm choice={choice} onBack={start ? undefined : () => setChoice(undefined)} onDone={onDone} />
}

function ServerForm({ choice, onBack, onDone }: { choice: Choice; onBack?: () => void; onDone: () => void }) {
  const servers = useAppStore((s) => s.mcp?.servers)
  const existing = useMemo(() => servers?.map((x) => x.name) ?? [], [servers])
  const preset = "preset" in choice ? choice.preset : undefined
  const custom = "custom" in choice ? choice.custom : undefined
  const base = preset?.id.split("-")[0] ?? ""
  const [name, setName] = useState(preset ? (existing.includes(base) ? preset.id : base) : "")
  const [url, setUrl] = useState("")
  const [command, setCommand] = useState("")
  const [token, setToken] = useState("")
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [scope, setScope] = useState<McpScope>(McpScope.Team)
  const [busy, setBusy] = useState(false)

  const tokenKey = `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_") || "SERVER"}_TOKEN`
  const nameError = !name ? "" : !NAME.test(name) ? "Letters, digits, - and _ only" : existing.includes(name) ? "Already added" : ""

  const config = (): McpTransportConfig | null => {
    if (preset) return preset.config
    if (custom === "http") {
      if (!/^https?:\/\/\S+$/.test(url.trim())) return null
      return { type: "http", url: url.trim(), ...(token.trim() ? { headers: { Authorization: `Bearer \${secret:${tokenKey}}` } } : {}) }
    }
    const parts = command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((p) => p.replace(/^["']|["']$/g, "")) ?? []
    if (!parts.length) return null
    return { type: "stdio", command: parts[0]!, ...(parts.length > 1 ? { args: parts.slice(1) } : {}) }
  }
  const presetSecrets = preset?.secrets ?? []
  const ready = !!name && !nameError && !!config() && presetSecrets.every((s) => secrets[s.name]?.trim())

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const c = config()
    if (!c || !ready) return
    setBusy(true)
    try {
      const values = { ...secrets, ...(custom === "http" && token.trim() ? { [tokenKey]: token.trim() } : {}) }
      await mcpApi.add({
        name,
        config: c,
        scope,
        ...(preset ? { preset: preset.id, description: preset.description } : {}),
        ...(Object.keys(values).length ? { secrets: values } : {}),
      })
      toast.success(`${name} added`, {
        description: c.type === "http" && !token.trim() && !presetSecrets.length ? "Checking the connection. If it needs a sign-in, you'll see a Sign in button." : "Checking the connection…",
      })
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {onBack && (
            <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back">
              <ArrowLeftIcon />
            </Button>
          )}
          {preset ? `Add ${preset.name}` : custom === "http" ? "Add a server by URL" : "Add a server by command"}
        </DialogTitle>
        <DialogDescription>
          {preset ? (
            <>
              {preset.auth}{" "}
              {preset.docs && (
                <a href={preset.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                  Docs <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </>
          ) : custom === "http" ? (
            "Remote MCP servers (Streamable HTTP). If the server uses OAuth, leave the token empty and sign in after adding."
          ) : (
            "A local MCP server started over stdio, e.g. npx -y @modelcontextprotocol/server-filesystem ."
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="mcp-name">Name</Label>
        <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value.trim())} placeholder="sentry" className="font-mono" autoFocus={!preset} />
        <p className={cn("text-xs", nameError ? "text-destructive" : "text-muted-foreground")}>
          {nameError || (name ? `Bots see its tools as mcp__${name}__…` : "Short and lowercase works best.")}
        </p>
      </div>

      {custom === "http" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-url">URL</Label>
            <Input id="mcp-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-token">
              Bearer token <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="mcp-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">Kept in your local secrets as {tokenKey}; mcp.json only stores a reference.</p>
          </div>
        </>
      )}
      {custom === "stdio" && (
        <div className="space-y-1.5">
          <Label htmlFor="mcp-cmd">Command</Label>
          <Input id="mcp-cmd" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @scope/mcp-server" className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">Runs in the repo folder. Use {"${secret:NAME}"} in mcp.json for tokens.</p>
        </div>
      )}

      {presetSecrets.map((s) => (
        <div key={s.name} className="space-y-1.5">
          <Label htmlFor={`mcp-${s.name}`}>{s.label}</Label>
          <Input
            id={`mcp-${s.name}`}
            type="password"
            autoComplete="off"
            value={secrets[s.name] ?? ""}
            onChange={(e) => setSecrets({ ...secrets, [s.name]: e.target.value })}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            {s.help}{" "}
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                Create one <ExternalLinkIcon className="size-3" />
              </a>
            )}
          </p>
        </div>
      ))}

      <div className="space-y-1.5">
        <Label>Who gets it</Label>
        <div className="grid grid-cols-2 gap-2">
          <ScopeOption active={scope === McpScope.Team} onClick={() => setScope(McpScope.Team)} icon={UsersIcon} title="Team" text="Saved in .agentroom/mcp.json and committed. Tokens stay on each machine." />
          <ScopeOption active={scope === McpScope.Personal} onClick={() => setScope(McpScope.Personal)} icon={UserIcon} title="Only me" text="Saved in runs/ on this machine, never committed." />
        </div>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={!ready || busy}>
          {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
          Add server
        </Button>
      </DialogFooter>
    </form>
  )
}

function ScopeOption({ active, onClick, icon: Icon, title, text }: { active: boolean; onClick: () => void; icon: typeof UsersIcon; title: string; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("rounded-xl border p-3 text-left transition-colors", active ? "border-primary bg-primary/5" : "hover:bg-muted")}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4" /> {title}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{text}</span>
    </button>
  )
}
