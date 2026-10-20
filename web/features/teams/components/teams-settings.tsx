"use client"

import { useEffect, useState } from "react"
import { CheckIcon, ChevronRightIcon, CopyIcon, KeyRoundIcon, Loader2Icon, PlusIcon, SendIcon, Trash2Icon, UserPlusIcon } from "lucide-react"
import { toast } from "sonner"
import type { TeamsConfig, TeamsRole, TeamsStatus, TeamsUser } from "@shared"
import { cn } from "@/lib/utils"
import { teamsApi } from "@/lib/api/intake-endpoints"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { Dropdown } from "@/components/kit/dropdown"
import { TeamsMark } from "@/components/kit/brand-icons"

const ROLES: { value: TeamsRole; label: string; sublabel: string }[] = [
  { value: "member", label: "Member", sublabel: "Start goals, see status" },
  { value: "approver", label: "Approver", sublabel: "Also approve plans and requests" },
]

/**
 * Microsoft Teams in Settings → Integrations: a channel's outgoing webhook brings requests in
 * (signed, allow-listed people only), a Workflows webhook posts plans and progress back.
 */
export function TeamsSettings() {
  const [status, setStatus] = useState<TeamsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    teamsApi
      .status()
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
  }, [])

  const update = async (patch: Partial<TeamsConfig>) => {
    try {
      setStatus(await teamsApi.update(patch))
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const ready = !!status && status.hasSecret && status.hasWorkflow && !!status.callbackUrl && status.config.users.length > 0
  const state = !status ? null : status.config.enabled && ready ? { tone: "success" as const, label: "On" } : status.config.enabled ? { tone: "warning" as const, label: "Setup incomplete" } : { tone: "neutral" as const, label: "Off" }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-surface text-brand">
          <TeamsMark className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            Microsoft Teams
            {state && (
              <ToneBadge size="sm" tone={state.tone} dot>
                {state.label}
              </ToneBadge>
            )}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Mention <span className="font-medium text-foreground">@AgentRoom</span> in a channel to start a goal or hand off an issue; plans and pull requests come back to the channel. Only people you list here can use it.
          </p>
        </div>
        {status && <Switch checked={status.config.enabled} onCheckedChange={(v) => void update({ enabled: v })} aria-label="Turn Teams on" />}
      </div>

      {error && <Callout tone="warning" title="Couldn't load the Teams setup">{error}</Callout>}
      {status && (
        <ol className="space-y-3">
          <Step n={1} done={!!status.callbackUrl} title="A public address for this machine">
            <PublicUrlStep status={status} onSave={(publicUrl) => update({ publicUrl })} />
          </Step>
          <Step n={2} done={status.hasSecret} title="Outgoing webhook (messages in)">
            <OutgoingStep status={status} onStatus={setStatus} />
          </Step>
          <Step n={3} done={status.hasWorkflow} title="Workflow webhook (updates out)">
            <WorkflowStep status={status} onStatus={setStatus} />
          </Step>
          <Step n={4} done={status.config.users.length > 0} title="Who can use it">
            <PeopleStep status={status} onSave={(users) => update({ users })} />
          </Step>
          <Step n={5} done title="Behaviour">
            <div className="space-y-3">
              <ToggleRow id="teams-plan" label="Stop after the plan" hint="Goals from Teams wait for an approver (in Teams or AgentRoom) before anything is built." checked={status.config.stopAfterPlan} onChange={(v) => void update({ stopAfterPlan: v })} />
              <ToggleRow id="teams-all" label="Post updates for every goal" hint="Not just the ones started from Teams." checked={status.config.announceAll} onChange={(v) => void update({ announceAll: v })} />
            </div>
          </Step>
        </ol>
      )}
      {status?.lastInboundAt && <p className="text-xs text-muted-foreground">Last message from Teams {timeAgo(Date.parse(status.lastInboundAt))}.</p>}
    </div>
  )
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li>
      <Collapsible defaultOpen={!done} className="rounded-xl border">
        <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold", done ? "tone-success tone-soft" : "bg-surface")}>{done ? <CheckIcon className="size-3" /> : n}</span>
          <span className="flex-1 text-sm font-medium">{title}</span>
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-3 py-3">{children}</CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function ToggleRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied"))
}

function PublicUrlStep({ status, onSave }: { status: TeamsStatus; onSave: (url: string) => Promise<boolean> }) {
  const [url, setUrl] = useState(status.config.publicUrl)
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Teams posts mentions to an HTTPS address. Point a tunnel with a fixed name at this machine (for example a named <code className="font-mono text-xs">cloudflared</code> tunnel or a reserved ngrok domain forwarding to AgentRoom&apos;s port) and paste its base URL. Only the signed <code className="font-mono text-xs">/teams/inbound</code> endpoint answers through it.
      </p>
      <div className="flex gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://agentroom.example.com" className="font-mono text-xs" aria-label="Public base URL" />
        <Button size="sm" variant="outline" onClick={() => void onSave(url.trim())} disabled={url.trim() === status.config.publicUrl}>
          Save
        </Button>
      </div>
      {status.publicUrlSource === "phone-tunnel" && (
        <Callout tone="warning">Using the phone-approvals tunnel for now. Its address changes every time it starts, so you&apos;d have to edit the outgoing webhook each time.</Callout>
      )}
      {status.callbackUrl ? (
        <div className="flex items-center gap-2 rounded-lg bg-sunken/70 px-3 py-2">
          <span className="text-xs text-muted-foreground">Callback URL</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{status.callbackUrl}</code>
          <Button size="icon-xs" variant="ghost" aria-label="Copy callback URL" onClick={() => copy(status.callbackUrl!)}>
            <CopyIcon />
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No public address yet: save one above, or turn on phone approvals (Settings → Remote approvals) for a temporary one.</p>
      )}
    </div>
  )
}

function SecretField({ label, placeholder, onSave, isSet }: { label: string; placeholder: string; onSave: (v: string) => Promise<void>; isSet: boolean }) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async (v: string) => {
    setBusy(true)
    try {
      await onSave(v)
      setValue("")
      toast.success(v ? "Saved on this machine" : "Removed")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <KeyRoundIcon className="size-3.5 text-muted-foreground" /> {label}
        {isSet && (
          <ToneBadge size="sm" tone="success">
            Set
          </ToneBadge>
        )}
      </Label>
      <div className="flex gap-2">
        <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={isSet ? "Paste a new value to replace it" : placeholder} className="font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={busy || !value.trim()} onClick={() => save(value.trim())}>
          {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Save
        </Button>
        {isSet && (
          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${label}`} onClick={() => save("")}>
            <Trash2Icon />
          </Button>
        )}
      </div>
    </div>
  )
}

function OutgoingStep({ status, onStatus }: { status: TeamsStatus; onStatus: (s: TeamsStatus) => void }) {
  return (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>In Teams, open the team → ⋯ → <span className="text-foreground">Manage team</span> → <span className="text-foreground">Apps</span> → <span className="text-foreground">Create an outgoing webhook</span>.</li>
        <li>
          Name it <span className="font-medium text-foreground">AgentRoom</span>, paste the callback URL from step 1, and create it.
        </li>
        <li>Teams shows a security token once. Paste it here.</li>
      </ol>
      <SecretField label="Security token" placeholder="Base64 token from Teams" isSet={status.hasSecret} onSave={async (v) => onStatus(await teamsApi.secrets({ outgoingSecret: v }))} />
      <p className="text-xs text-muted-foreground">Every message is checked against this token (HMAC). Stored only on this machine.</p>
    </div>
  )
}

function WorkflowStep({ status, onStatus }: { status: TeamsStatus; onStatus: (s: TeamsStatus) => void }) {
  const [busy, setBusy] = useState(false)
  const test = async () => {
    setBusy(true)
    try {
      await teamsApi.test()
      toast.success("Test card sent", { description: "Check the channel." })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          In the channel, open ⋯ → <span className="text-foreground">Workflows</span> → <span className="text-foreground">Post to a channel when a webhook request is received</span>.
        </li>
        <li>Pick the team and channel, then copy the URL it gives you.</li>
      </ol>
      <SecretField label="Workflow URL" placeholder="https://…logic.azure.com/… or …powerplatform.com/…" isSet={status.hasWorkflow} onSave={async (v) => onStatus(await teamsApi.secrets({ workflowUrl: v }))} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={!status.hasWorkflow || busy} onClick={test}>
          {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />} Send a test card
        </Button>
        <span className="text-xs text-muted-foreground">Daily digests to Teams use this URL too.</span>
      </div>
    </div>
  )
}

function PeopleStep({ status, onSave }: { status: TeamsStatus; onSave: (users: TeamsUser[]) => Promise<boolean> }) {
  const users = status.config.users
  const [id, setId] = useState("")
  const [name, setName] = useState("")
  const set = (next: TeamsUser[]) => void onSave(next)
  const add = async (u: TeamsUser) => {
    if (await onSave([...users, u])) {
      setId("")
      setName("")
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Anyone else who mentions the bot gets a reply with their id and shows up below, so you can add them. Approvals they make are logged with the git identity you give them.
      </p>
      {users.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {users.map((u, i) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{u.name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{u.id}</span>
              </span>
              <Input
                defaultValue={u.identity ?? ""}
                placeholder="Name <email> for the audit log"
                aria-label={`Git identity of ${u.name}`}
                className="h-8 w-56 text-xs"
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v !== (u.identity ?? "")) set(users.map((x, j) => (j === i ? { ...x, ...(v ? { identity: v } : { identity: undefined }) } : x)))
                }}
              />
              <div className="w-36">
                <Dropdown<string> variant="pill" showSearch={false} datas={ROLES} selectedValue={u.role} onSelect={(v) => set(users.map((x, j) => (j === i ? { ...x, role: v as TeamsRole } : x)))} />
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${u.name}`} onClick={() => set(users.filter((_, j) => j !== i))}>
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {status.unknown.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Asked recently, not on the list</p>
          <ul className="space-y-1">
            {status.unknown.map((u) => (
              <li key={u.id} className="flex items-center gap-2 rounded-lg bg-sunken/60 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{u.name}</span> <span className="text-xs text-muted-foreground">· {timeAgo(Date.parse(u.at))} · “{u.text}”</span>
                </span>
                <Button size="xs" variant="outline" onClick={() => void add({ id: u.id, name: u.name, role: "member" })}>
                  <UserPlusIcon data-icon="inline-start" /> Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" className="w-40" />
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="Azure AD object id" aria-label="Azure AD object id" className="min-w-0 flex-1 font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={!id.trim() || !name.trim()} onClick={() => void add({ id: id.trim(), name: name.trim(), role: "member" })}>
          <PlusIcon data-icon="inline-start" /> Add
        </Button>
      </div>
    </div>
  )
}
