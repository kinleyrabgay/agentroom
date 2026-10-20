"use client"

import { useCallback, useEffect, useState } from "react"
import { BotIcon, CheckIcon, FileTextIcon, GlobeIcon, PlusIcon, RefreshCwIcon, SlidersHorizontalIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import type { PackResult, PackView, RegistrySource } from "@shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { ErrorState } from "@/components/kit/state-view"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { SaveIndicator } from "@/features/settings/components/save-indicator"
import { SettingsCard } from "@/features/settings/components/settings-card"
import { useSettingsSection } from "@/features/settings/hooks/use-settings-section"
import { SettingsSection } from "@/features/settings/lib/constants"
import { describeResult, packApi } from "../lib/api"

/** Settings → Packs: ready-made teams for a stack, and where Browse skills searches. */
export function PacksSection() {
  return (
    <SettingsCard id={SettingsSection.Packs}>
      <div className="space-y-6">
        <PackList />
        <Separator />
        <Registries />
      </div>
    </SettingsCard>
  )
}

function PackList() {
  const [packs, setPacks] = useState<PackView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<PackResult | null>(null)

  const load = useCallback(() => {
    packApi
      .list()
      .then((p) => {
        setPacks(p)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(load, [load])

  const run = async (name: string, action: "install" | "update" | "remove") => {
    setBusy(name)
    try {
      const r = await packApi[action](name)
      setResult(action === "remove" ? null : r)
      toast.success(`${action === "install" ? "Installed" : action === "update" ? "Updated" : "Removed"} ${r.name}`, { description: describeResult(r) })
      load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <ErrorState error={error} onRetry={load} />
  if (!packs)
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    )

  const sorted = [...packs].sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.title.localeCompare(b.title))
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        A pack adds bots, skills, goal templates and settings for your stack. Updates merge with your edits; files you changed are never overwritten.
      </p>
      {result && result.conflicts.length > 0 && (
        <Callout
          tone="warning"
          title={`${result.conflicts.length} file${result.conflicts.length === 1 ? "" : "s"} to merge by hand`}
          action={
            <Button size="xs" variant="ghost" onClick={() => setResult(null)}>
              Dismiss
            </Button>
          }
        >
          You and the pack changed the same lines. Your version is kept; the pack&apos;s is next to it as <code className="font-mono text-xs">.pack-incoming</code>:
          <ul className="mt-1.5 space-y-0.5">
            {result.conflicts.map((c) => (
              <li key={c} className="font-mono text-xs">
                .agentroom/{c}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <ul className="space-y-3">
        {sorted.map((p) => (
          <PackRow key={p.name} pack={p} busy={busy === p.name} onRun={(a) => run(p.name, a)} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        From the terminal: <code className="font-mono">agentroom pack add &lt;name or folder&gt;</code>. A pack is a folder with <code className="font-mono">pack.json</code>, so your team can write its own.
      </p>
    </div>
  )
}

function PackRow({ pack, busy, onRun }: { pack: PackView; busy: boolean; onRun: (a: "install" | "update" | "remove") => void }) {
  const installed = pack.installed
  const outdated = installed?.updateAvailable
  const counts = [
    { icon: BotIcon, n: pack.contents.bots.length, label: "bot", items: pack.contents.bots },
    { icon: SparklesIcon, n: pack.contents.skills.length, label: "skill", items: pack.contents.skills },
    { icon: FileTextIcon, n: pack.contents.goalTemplates.length, label: "goal template", items: pack.contents.goalTemplates },
  ].filter((c) => c.n > 0)
  return (
    <li className="rounded-xl border bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{pack.title}</span>
            <span className="font-mono text-xs text-muted-foreground">{pack.version}</span>
            {pack.suggested && !installed && (
              <ToneBadge tone="brand" size="sm" title={pack.reason}>
                Fits this repo
              </ToneBadge>
            )}
            {installed && (
              <ToneBadge tone="success" size="sm" icon={CheckIcon}>
                Installed {installed.version}
              </ToneBadge>
            )}
            {installed && installed.modified > 0 && (
              <ToneBadge tone="neutral" size="sm" title="Files you've edited since installing. Updates merge with them.">
                {installed.modified} edited
              </ToneBadge>
            )}
            {pack.origin === "local" && <ToneBadge size="sm">Local folder</ToneBadge>}
          </div>
          <p className="text-sm text-pretty text-muted-foreground">{pack.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!installed && (
            <Button size="sm" variant={pack.suggested ? "default" : "outline"} onClick={() => onRun("install")} disabled={busy}>
              <PlusIcon data-icon="inline-start" /> {busy ? "Installing…" : "Install"}
            </Button>
          )}
          {installed && (
            <Button size="sm" variant={outdated ? "default" : "outline"} onClick={() => onRun("update")} disabled={busy} title="Merge the pack's current files with yours">
              <RefreshCwIcon data-icon="inline-start" className={busy ? "animate-spin" : undefined} /> {outdated ? `Update to ${pack.version}` : "Reapply"}
            </Button>
          )}
          {installed && (
            <ConfirmDelete
              label="Remove"
              title={`Remove ${pack.title}?`}
              description="Removes the pack's bots, skills and goal templates. Files you edited stay, and settings are left as they are."
              onConfirm={() => onRun("remove")}
            />
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {counts.map(({ icon: Icon, n, label, items }) => (
          <span key={label} className="inline-flex items-center gap-1.5" title={items.join(", ")}>
            <Icon className="size-3.5" aria-hidden />
            {n} {label}
            {n === 1 ? "" : "s"}
          </span>
        ))}
        {pack.contents.settings && (
          <span className="inline-flex items-center gap-1.5" title="Merged into settings.json; values you changed are kept">
            <SlidersHorizontalIcon className="size-3.5" aria-hidden />
            security paths
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-1">
          {pack.stacks.map((s) => (
            <ToneBadge key={s} size="sm">
              {s}
            </ToneBadge>
          ))}
        </span>
      </div>
    </li>
  )
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)

function Registries() {
  const { value, update, status } = useSettingsSection("registries")
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  if (!value) return null
  const sources = value.sources as RegistrySource[]
  const validUrl = /^https:\/\/\S+$/.test(url.trim())
  const add = () => {
    const id = slug(name) || "registry"
    if (sources.some((s) => s.id === id)) return toast.error(`A registry called ${name} already exists`)
    update({ sources: [...sources, { id, name: name.trim() || id, kind: "index", url: url.trim(), enabled: true }] })
    setName("")
    setUrl("")
  }
  const patch = (id: string, change: Partial<RegistrySource>) => update({ sources: sources.map((s) => (s.id === id ? { ...s, ...change } : s)) })
  const remove = (id: string) => update({ sources: sources.filter((s) => s.id !== id) })

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Skill registries</h3>
          <p className="text-xs text-muted-foreground">Where Browse skills searches. Every skill is shown in full before it&apos;s installed, and nothing in it runs on install.</p>
        </div>
        <SaveIndicator status={status} />
      </div>
      <ul className="divide-y rounded-xl border">
        {sources.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <GlobeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <ToneBadge size="sm">{s.kind === "skills-sh" ? "skills.sh directory" : "Index"}</ToneBadge>
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground">{s.url}</p>
            </div>
            <Switch checked={s.enabled} onCheckedChange={(enabled) => patch(s.id, { enabled })} aria-label={`Search ${s.name}`} />
            <Button size="icon-sm" variant="ghost" onClick={() => remove(s.id)} aria-label={`Remove ${s.name}`}>
              <Trash2Icon />
            </Button>
          </li>
        ))}
        {!sources.length && <li className="px-3.5 py-4 text-center text-sm text-muted-foreground">No registries. Browse skills can still import files.</li>}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid w-40 gap-1.5">
          <Label htmlFor="reg-name" className="text-xs">
            Name
          </Label>
          <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme internal" />
        </div>
        <div className="grid min-w-56 flex-1 gap-1.5">
          <Label htmlFor="reg-url" className="text-xs">
            Index URL
          </Label>
          <Input id="reg-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://skills.acme.dev/index.json" className="font-mono" aria-invalid={!!url && !validUrl} />
        </div>
        <Button size="sm" variant="outline" disabled={!validUrl || !name.trim()} onClick={add}>
          <PlusIcon data-icon="inline-start" /> Add registry
        </Button>
      </div>
    </div>
  )
}
