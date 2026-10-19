"use client"

import { useEffect, useState } from "react"
import { Loader2Icon, MailIcon, MessageSquareIcon, PlugIcon } from "lucide-react"
import { toast } from "sonner"
import type { IntegrationStatus } from "@shared"
import { integrationsApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToneBadge } from "@/components/kit/badge"
import { GithubConnectionSettings } from "@/features/github/components/github-connection-settings"
import { SentryConnectionSettings } from "@/features/sentry/components/sentry-connection-settings"
import { McpServersSection } from "@/features/connections/components/connections-page"
import { SettingsSection } from "../lib/constants"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { useSettingsSection } from "../hooks/use-settings-section"
import { SaveIndicator } from "./save-indicator"
import { SettingsCard } from "./settings-card"

/** The one place to connect services: GitHub, Sentry, MCP servers, and where digests go. */
export function IntegrationsSection() {
  return (
    <SettingsCard id={SettingsSection.Integrations}>
      <div className="space-y-4">
        {/* GitHub and Sentry draw their own header and frame. */}
        <GithubConnectionSettings />
        <SentryConnectionSettings />
        <Block icon={<PlugIcon className="size-4" />} title="MCP servers" description="External tools your bots can use, like Sentry or Linear.">
          <McpServersSection />
        </Block>
        <Block icon={<MessageSquareIcon className="size-4" />} title="Digests" description="A short daily summary posted to Slack or Teams. Webhooks are stored only on this machine.">
          <div className="space-y-5">
            <DigestSchedule />
            <DigestChannels />
          </div>
        </Block>
      </div>
    </SettingsCard>
  )
}

function Block({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border" aria-label={title}>
      <header className="flex items-start gap-3 border-b bg-sunken/50 px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-surface">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

type Channel = "slackWebhook" | "teamsWebhook"
const CHANNELS: { key: Channel; status: keyof IntegrationStatus; label: string; placeholder: string }[] = [
  { key: "slackWebhook", status: "slack", label: "Slack incoming webhook", placeholder: "https://hooks.slack.com/services/…" },
  { key: "teamsWebhook", status: "teams", label: "Microsoft Teams webhook", placeholder: "https://…webhook.office.com/…" },
]

/** Webhook URLs (write-only: the server only says whether each is set). */
function DigestChannels() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [values, setValues] = useState<Record<Channel, string>>({ slackWebhook: "", teamsWebhook: "" })
  const [busy, setBusy] = useState<Channel | null>(null)

  useEffect(() => {
    integrationsApi.get().then(setStatus).catch(() => setStatus({ slack: false, teams: false, email: false }))
  }, [])

  const save = async (key: Channel, value: string) => {
    setBusy(key)
    try {
      setStatus(await integrationsApi.update({ [key]: value }))
      setValues((v) => ({ ...v, [key]: "" }))
      toast.success(value ? "Saved" : "Removed")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {CHANNELS.map((c) => {
        const set = !!status?.[c.status]
        return (
          <form
            key={c.key}
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (values[c.key].trim()) void save(c.key, values[c.key].trim())
            }}
          >
            <div className="flex items-center gap-2">
              <Label htmlFor={`digest-${c.key}`}>{c.label}</Label>
              {set && (
                <ToneBadge tone="success" size="sm" dot>
                  Connected
                </ToneBadge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                id={`digest-${c.key}`}
                type="password"
                autoComplete="off"
                value={values[c.key]}
                onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
                placeholder={set ? "Paste a new URL to replace it" : c.placeholder}
                className="font-mono text-xs"
              />
              <Button type="submit" size="sm" variant="outline" disabled={!values[c.key].trim() || busy === c.key}>
                {busy === c.key && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Save
              </Button>
              {set && (
                <Button type="button" size="sm" variant="ghost" className="tone-danger tone-text" onClick={() => void save(c.key, "")} disabled={busy === c.key}>
                  Remove
                </Button>
              )}
            </div>
          </form>
        )
      })}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MailIcon className="size-3.5" />
        Email digests use SMTP settings in <code className="font-mono">.agentroom/runs/secrets.json</code>
        {status?.email ? " (configured)." : "."}
      </p>
    </div>
  )
}

/** When the daily digest goes out, and where (team setting; the webhooks themselves stay local). */
function DigestSchedule() {
  const { value, update, status } = useSettingsSection("digest")
  const channels = value?.channels ?? ["slack"]
  const toggle = (ch: "slack" | "teams") => update({ channels: channels.includes(ch) ? channels.filter((c) => c !== ch) : [...channels, ch] })
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="digest-on">Send a daily digest</Label>
          <p className="text-xs text-muted-foreground">e.g. “3 goals done, 2 PRs ready, 1 needs you, $4.92 spent”, with a link back to AgentRoom.</p>
        </div>
        <div className="flex items-center gap-2">
          <SaveIndicator status={status} />
          <Switch id="digest-on" checked={!!value?.enabled} onCheckedChange={(enabled) => update({ enabled })} />
        </div>
      </div>
      {value?.enabled && (
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="digest-time" className="text-xs text-muted-foreground">Every day at</Label>
          <Input id="digest-time" type="time" value={value.time} onChange={(e) => e.target.value && update({ time: e.target.value })} className="w-32" />
          <span className="text-xs text-muted-foreground">to</span>
          {(["slack", "teams"] as const).map((ch) => (
            <label key={ch} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={channels.includes(ch)} onCheckedChange={() => toggle(ch)} /> {ch === "slack" ? "Slack" : "Teams"}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
