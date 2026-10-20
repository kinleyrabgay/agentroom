"use client"

import { useEffect, useState } from "react"
import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import type { TrackerId, TrackerScope, TrackerSync } from "@shared"
import { cn } from "@/lib/utils"
import { trackerApi } from "@/lib/api/intake-endpoints"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Dropdown } from "@/components/kit/dropdown"
import { TRACKER_META } from "../lib/meta"
import { loadTrackerIssues, setTracker, useTrackerStore } from "../lib/tracker-store"

type Step = "credentials" | "scope"

/**
 * Connect Linear or Jira in two steps: credentials (stored only on this machine), then the team or
 * project and the optional status sync (saved for the team in `.agentroom/integrations/<tracker>.json`).
 */
export function ConnectTracker({ tracker, startAt }: { tracker: TrackerId; startAt: Step }) {
  const meta = TRACKER_META[tracker]
  const [step, setStep] = useState<Step>(startAt)
  const [scopes, setScopes] = useState<TrackerScope[] | null>(null)
  const editing = useTrackerStore((s) => s[tracker].editing)
  const Icon = meta.icon

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-xl px-6 py-10">
        <div className="mb-6 flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border bg-surface text-brand shadow-xs">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight">{editing ? `${meta.label} settings` : `Connect ${meta.label}`}</h2>
            <p className="text-sm text-muted-foreground">See your {meta.scope}&apos;s issues here and hand any of them to the team.</p>
          </div>
          {editing && (
            <Button variant="ghost" size="sm" onClick={() => setTracker(tracker, { editing: false })}>
              Cancel
            </Button>
          )}
        </div>
        <Steps step={step} scopeLabel={tracker === "linear" ? "Team & sync" : "Project & sync"} />
        <div className="mt-5 rounded-2xl border bg-card p-6 shadow-xs">
          {step === "credentials" ? (
            <CredentialsStep
              tracker={tracker}
              onDone={(list) => {
                setScopes(list)
                setStep("scope")
              }}
            />
          ) : (
            <ScopeStep tracker={tracker} initialScopes={scopes} onChangeCredentials={() => setStep("credentials")} />
          )}
        </div>
      </div>
    </div>
  )
}

function Steps({ step, scopeLabel }: { step: Step; scopeLabel: string }) {
  const items: { id: Step; label: string }[] = [
    { id: "credentials", label: "Credentials" },
    { id: "scope", label: scopeLabel },
  ]
  return (
    <ol className="flex items-center gap-2 text-xs">
      {items.map((it, i) => {
        const done = step === "scope" && it.id === "credentials"
        const active = step === it.id
        return (
          <li key={it.id} className="flex items-center gap-2">
            {i > 0 && <ChevronRightIcon className="size-3.5 text-muted-foreground" />}
            <span className={cn("grid size-6 place-items-center rounded-full border text-xs font-semibold", active && "border-brand bg-brand text-brand-foreground", done && "tone-success tone-soft")}>
              {done ? <CheckIcon className="size-3" /> : i + 1}
            </span>
            <span className={cn(active ? "font-medium text-foreground" : "text-muted-foreground")}>{it.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function CredentialsStep({ tracker, onDone }: { tracker: TrackerId; onDone: (scopes: TrackerScope[]) => void }) {
  const meta = TRACKER_META[tracker]
  const site = useTrackerStore((s) => s[tracker].status?.config?.site ?? "")
  const [apiKey, setApiKey] = useState("")
  const [jiraSite, setJiraSite] = useState(site)
  const [email, setEmail] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await trackerApi.connect(tracker, tracker === "linear" ? { apiKey } : { site: jiraSite, email, token })
      setApiKey("")
      setToken("")
      toast.success(`Signed in as ${res.viewer.name}`)
      onDone(res.scopes)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {tracker === "jira" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="jira-site">Jira site</Label>
            <Input id="jira-site" autoFocus value={jiraSite} onChange={(e) => setJiraSite(e.target.value)} placeholder="acme.atlassian.net" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="jira-email">Atlassian email</Label>
            <Input id="jira-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
        </>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="tracker-token" className="flex items-center gap-1.5">
          <KeyRoundIcon className="size-3.5 text-muted-foreground" /> {tracker === "linear" ? "API key" : "API token"}
        </Label>
        <Input
          id="tracker-token"
          type="password"
          autoComplete="off"
          autoFocus={tracker === "linear"}
          value={tracker === "linear" ? apiKey : token}
          onChange={(e) => (tracker === "linear" ? setApiKey(e.target.value) : setToken(e.target.value))}
          placeholder={tracker === "linear" ? "lin_api_…" : "ATATT…"}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          {meta.tokenHelp}{" "}
          <a href={meta.tokenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2">
            Create one <ExternalLinkIcon className="size-3" />
          </a>
        </p>
      </div>
      <p className="rounded-xl bg-sunken/70 px-3 py-2 text-xs text-muted-foreground">Stored only on this machine in <code className="font-mono">.agentroom/runs/secrets.json</code>. Teammates connect with their own.</p>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || (tracker === "linear" ? !apiKey.trim() : !token.trim() || !email.trim() || !jiraSite.trim())}>
          {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Continue
        </Button>
      </div>
    </form>
  )
}

const NONE = "__none__"

function ScopeStep({ tracker, initialScopes, onChangeCredentials }: { tracker: TrackerId; initialScopes: TrackerScope[] | null; onChangeCredentials: () => void }) {
  const meta = TRACKER_META[tracker]
  const config = useTrackerStore((s) => s[tracker].status?.config ?? null)
  const [scopes, setScopes] = useState<TrackerScope[] | null>(initialScopes)
  const [scopeId, setScopeId] = useState(config?.scopeId ?? "")
  const [filter, setFilter] = useState(config?.filter ?? "")
  const [sync, setSync] = useState<TrackerSync>(config?.sync ?? { onStart: null, onPr: null, commentPr: false })
  const [states, setStates] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (scopes) return
    trackerApi
      .scopes(tracker)
      .then(setScopes)
      .catch((e: Error) => {
        toast.error(e.message)
        setScopes([])
      })
  }, [scopes, tracker])

  // States of the saved scope, to offer for the sync rules.
  useEffect(() => {
    if (!config) return
    trackerApi
      .issues(tracker, {})
      .then((p) => setStates(p.states.map((s) => s.name)))
      .catch(() => {})
  }, [config, tracker])

  const save = async () => {
    const scope = scopes?.find((s) => s.id === scopeId)
    if (!scope) return toast.error(`Pick a ${meta.scope}.`)
    setBusy(true)
    try {
      const status = await trackerApi.saveConfig(tracker, { scopeId: scope.id, scopeKey: scope.key, scopeName: scope.name, ...(tracker === "jira" ? { filter } : {}), sync })
      setTracker(tracker, { status, editing: false })
      toast.success(`${meta.label}: ${scope.name}`)
      void loadTrackerIssues(tracker, { refresh: true })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const stateOptions = [{ label: "Don’t change it", value: NONE }, ...states.map((s) => ({ label: s, value: s }))]

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label className="capitalize">{meta.scope}</Label>
        {!scopes ? (
          <Skeleton className="h-9 w-full rounded-full" />
        ) : (
          <Dropdown<string>
            datas={scopes.map((s) => ({ label: s.name, value: s.id, sublabel: s.key }))}
            selectedValue={scopeId}
            placeholder={`Pick a ${meta.scope}`}
            hint={`Find a ${meta.scope}`}
            notfound={`No ${meta.scope}s.`}
            onSelect={(v) => setScopeId(v as string)}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Saved for the team in <code className="font-mono">{meta.file}</code>.
        </p>
      </div>

      {tracker === "jira" && (
        <div className="space-y-1.5">
          <Label htmlFor="jira-filter">Extra JQL filter (optional)</Label>
          <Input id="jira-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder='component = "Web" AND labels != wontfix' className="font-mono text-xs" />
        </div>
      )}

      <fieldset className="space-y-3 rounded-2xl border p-4">
        <legend className="px-1 text-sm font-medium">Status sync (optional)</legend>
        <p className="text-xs text-muted-foreground">
          Off by default: AgentRoom never writes to {meta.label} unless you turn these on. Every write is in the Audit log.
        </p>
        {config ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="font-normal">When its goal starts building, move the issue to</Label>
              <Dropdown<string> variant="pill" datas={stateOptions} selectedValue={sync.onStart ?? NONE} showSearch={states.length > 8} onSelect={(v) => setSync((s) => ({ ...s, onStart: v === NONE ? null : (v as string) }))} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="font-normal">When the PR opens, move it to</Label>
              <Dropdown<string> variant="pill" datas={stateOptions} selectedValue={sync.onPr ?? NONE} showSearch={states.length > 8} onSelect={(v) => setSync((s) => ({ ...s, onPr: v === NONE ? null : (v as string) }))} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="sync-comment" className="font-normal">Comment the PR link on the issue</Label>
              <Switch id="sync-comment" checked={sync.commentPr} onCheckedChange={(v) => setSync((s) => ({ ...s, commentPr: v }))} />
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Save the {meta.scope} first; then you can pick states here.</p>
        )}
      </fieldset>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onChangeCredentials}>
          Change credentials
        </Button>
        <Button onClick={save} disabled={busy || !scopeId}>
          {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Save
        </Button>
      </div>
    </div>
  )
}
