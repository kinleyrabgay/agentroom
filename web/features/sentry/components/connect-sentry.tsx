"use client"

import { useEffect, useState } from "react"
import { ArrowLeftIcon, BugIcon, CheckIcon, ChevronRightIcon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import type { SentryOrg, SentryProject } from "@shared"
import { cn } from "@/lib/utils"
import { sentryApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { TOKEN_SCOPES, TOKEN_URL } from "../constants"
import { loadStatus } from "../lib/actions"
import { setSentry, useSentryStore } from "../lib/sentry-store"

/**
 * Connect Sentry in two steps: a token (stored only on this machine), then the org and projects
 * the page shows (saved for the team in `.agentroom/sentry.json`).
 */
export function ConnectSentry({ startAt }: { startAt: "token" | "config" }) {
  const [step, setStep] = useState(startAt)
  const [orgs, setOrgs] = useState<SentryOrg[] | null>(null)
  const editing = useSentryStore((s) => s.editing)

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-xl px-6 py-10">
        <div className="mb-6 flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border bg-surface text-brand shadow-xs">
            <BugIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight">{editing ? "Sentry settings" : "Connect Sentry"}</h2>
            <p className="text-sm text-muted-foreground">See your project&apos;s errors here and hand any of them to a bot to fix.</p>
          </div>
          {editing && (
            <Button variant="ghost" size="sm" onClick={() => setSentry({ editing: false })}>
              Cancel
            </Button>
          )}
        </div>
        <Steps step={step} />
        <div className="mt-5 rounded-2xl border bg-card p-6 shadow-xs">
          {step === "token" ? (
            <TokenStep
              onDone={(list) => {
                setOrgs(list)
                setStep("config")
              }}
            />
          ) : (
            <ConfigStep initialOrgs={orgs} onChangeToken={() => setStep("token")} />
          )}
        </div>
      </div>
    </div>
  )
}

function Steps({ step }: { step: "token" | "config" }) {
  const items = [
    { id: "token", label: "Access token" },
    { id: "config", label: "Organization & projects" },
  ]
  return (
    <ol className="flex items-center gap-2 text-xs">
      {items.map((it, i) => {
        const done = step === "config" && it.id === "token"
        const active = step === it.id
        return (
          <li key={it.id} className="flex items-center gap-2">
            {i > 0 && <ChevronRightIcon className="size-3.5 text-muted-foreground" />}
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-xs font-semibold",
                active && "border-brand bg-brand text-brand-foreground",
                done && "tone-success tone-soft"
              )}
            >
              {done ? <CheckIcon className="size-3" /> : i + 1}
            </span>
            <span className={cn(active ? "font-medium text-foreground" : "text-muted-foreground")}>{it.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function TokenStep({ onDone }: { onDone: (orgs: SentryOrg[]) => void }) {
  const [token, setToken] = useState("")
  const [host, setHost] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    try {
      const { orgs } = await sentryApi.setToken(token.trim(), host.trim() || undefined)
      setToken("")
      onDone(orgs)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="sentry-token" className="flex items-center gap-1.5">
          <KeyRoundIcon className="size-3.5 text-muted-foreground" /> User auth token
        </Label>
        <Input id="sentry-token" type="password" autoComplete="off" autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="sntryu_…" className="font-mono text-xs" />
        <p className="text-xs text-muted-foreground">
          Create one with scopes{" "}
          {TOKEN_SCOPES.map((s, i) => (
            <span key={s}>
              <code className="rounded bg-muted px-1 font-mono text-xs">{s}</code>
              {i < TOKEN_SCOPES.length - 1 ? ", " : ""}
            </span>
          ))}
          .{" "}
          <a href={TOKEN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2">
            Create a token <ExternalLinkIcon className="size-3" />
          </a>
        </p>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" /> Self-hosted Sentry?
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Label htmlFor="sentry-host" className="text-xs">Sentry URL</Label>
          <Input id="sentry-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://sentry.example.com" className="mt-1 h-8 font-mono text-xs" />
        </CollapsibleContent>
      </Collapsible>

      <div className="rounded-xl bg-sunken px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        Stored only on this machine (<code className="font-mono">.agentroom/runs/secrets.json</code>, never committed). The same token also powers the
        Sentry MCP server in Settings → Integrations.
      </div>

      <Button type="submit" disabled={!token.trim() || busy}>
        {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Check token
      </Button>
    </form>
  )
}

function ConfigStep({ initialOrgs, onChangeToken }: { initialOrgs: SentryOrg[] | null; onChangeToken: () => void }) {
  const status = useSentryStore((s) => s.status)
  const current = status?.config
  const [orgs, setOrgs] = useState<SentryOrg[] | null>(initialOrgs)
  const [orgsError, setOrgsError] = useState<string | null>(null)
  const [org, setOrg] = useState<string>(current?.org ?? initialOrgs?.[0]?.slug ?? "")
  const [projectsByOrg, setProjectsByOrg] = useState<Record<string, SentryProject[]>>({})
  const projects = projectsByOrg[org] ?? null
  const [picked, setPicked] = useState<string[]>(current?.projects ?? [])
  const [environment, setEnvironment] = useState(current?.environment ?? "")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (orgs) return
    sentryApi
      .orgs()
      .then((list) => {
        setOrgs(list)
        setOrg((o) => o || list[0]?.slug || "")
      })
      .catch((e) => setOrgsError((e as Error).message))
  }, [orgs])

  useEffect(() => {
    if (!org || projectsByOrg[org]) return
    sentryApi
      .projects(org)
      .then((list) => setProjectsByOrg((m) => ({ ...m, [org]: list })))
      .catch((e) => toast.error((e as Error).message))
  }, [org, projectsByOrg])

  const chooseOrg = (slug: string) => {
    setOrg(slug)
    if (slug !== current?.org) setPicked([])
  }
  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]))

  const save = async () => {
    setBusy(true)
    try {
      await sentryApi.connect({ org, projects: picked, ...(environment.trim() ? { environment: environment.trim() } : {}) })
      setSentry({ editing: false, issues: [], nextCursor: null, selected: [], details: {} })
      await loadStatus()
      toast.success("Sentry connected")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (orgsError) {
    return (
      <div className="space-y-3 text-sm">
        <p className="tone-danger tone-text">{orgsError}</p>
        <Button size="sm" variant="outline" onClick={onChangeToken}>
          <ArrowLeftIcon data-icon="inline-start" /> Use another token
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Organization</Label>
        {!orgs ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : orgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">This token can&apos;t see any organization. Check its scopes.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {orgs.map((o) => (
              <button
                key={o.slug}
                type="button"
                onClick={() => chooseOrg(o.slug)}
                aria-pressed={org === o.slug}
                className={cn(
                  "h-8 rounded-full border px-3 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  org === o.slug ? "tone-brand tone-soft font-medium text-foreground" : "bg-surface text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {o.name}
                <span className="ml-1.5 font-mono text-xs opacity-60">{o.slug}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>Projects</Label>
          <span className="text-xs text-muted-foreground">{picked.length ? `${picked.length} selected` : "All projects"}</span>
        </div>
        {!projects ? (
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border p-1">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
              <Checkbox checked={picked.length === 0} onCheckedChange={() => setPicked([])} />
              <span className="font-medium">All projects</span>
              <span className="ml-auto text-xs text-muted-foreground">{projects.length}</span>
            </label>
            {projects.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
                <Checkbox checked={picked.includes(p.slug)} onCheckedChange={() => toggle(p.slug)} />
                <span className="truncate">{p.name}</span>
                {p.platform && <span className="ml-auto font-mono text-xs text-muted-foreground">{p.platform}</span>}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sentry-env">
          Default environment <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="sentry-env" value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="production" className="h-8 text-sm" />
      </div>

      <div className="flex items-center gap-2 border-t pt-4">
        <Button onClick={save} disabled={!org || busy}>
          {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Save and show issues
        </Button>
        <Button variant="ghost" size="sm" onClick={onChangeToken}>
          <KeyRoundIcon data-icon="inline-start" /> Change token
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Saved for the team in .agentroom/sentry.json</span>
      </div>
    </div>
  )
}
