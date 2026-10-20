"use client"

import { useCallback, useEffect, useState } from "react"
import { CopyIcon, FolderGit2Icon, FolderPlusIcon, Loader2Icon, MoreHorizontalIcon, StarIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import type { WorkspacesView, WorkspaceView } from "@shared"
import { workspaceApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Callout } from "@/components/kit/callout"
import { ToneBadge } from "@/components/kit/badge"
import { SettingsCard } from "@/features/settings/components/settings-card"
import { SettingsSection } from "@/features/settings/lib/constants"
import { useWorkspaceStore } from "../lib/workspace-store"

const copy = (text: string) =>
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copied"))
    .catch(() => toast.error("Couldn't copy"))

/** A shell command with a copy button. */
function Command({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-sunken px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{text}</code>
      <Button size="icon-xs" variant="ghost" aria-label="Copy command" onClick={() => copy(text)}>
        <CopyIcon />
      </Button>
    </div>
  )
}

/**
 * Settings → Workspace: the repos this server works on together. Repos and the primary repo apply
 * after a restart; each repo's app settings (dev command, URL) apply right away.
 */
export function WorkspaceSection() {
  const current = useWorkspaceStore((s) => s.workspace)
  const [view, setView] = useState<WorkspacesView | null>(null)
  const [live, setLive] = useState<WorkspaceView | null>(current)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    workspaceApi
      .list()
      .then((v) => (setView(v), setError(null)))
      .catch((e: Error) => setError(e.message))
    workspaceApi
      .get()
      .then(setLive)
      .catch(() => {})
  }, [])
  useEffect(load, [load])

  return (
    <SettingsCard
      id={SettingsSection.Workspace}
      aside={
        live ? (
          <ToneBadge tone="brand" icon={FolderGit2Icon}>
            {live.name} · {live.repos.length} repos
          </ToneBadge>
        ) : undefined
      }
    >
      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : !view ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : live ? (
        <CurrentWorkspace live={live} onChanged={load} />
      ) : (
        <CreateWorkspace projectRoot={view.projectRoot} onCreated={load} />
      )}
      {view && view.list.filter((w) => !w.current).length > 0 && (
        <details className="mt-5 border-t pt-4 text-sm">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">Other workspaces ({view.list.filter((w) => !w.current).length})</summary>
          <ul className="mt-3 space-y-3">
            {view.list
              .filter((w) => !w.current)
              .map((w) => (
                <li key={w.name} className="space-y-1.5">
                  <p className="text-sm">
                    <span className="font-medium">{w.name}</span> <span className="text-muted-foreground">· {w.repos.map((r) => r.id).join(", ")}</span>
                  </p>
                  <Command text={`agentroom start --workspace ${w.name}`} />
                </li>
              ))}
          </ul>
        </details>
      )}
    </SettingsCard>
  )
}

function CurrentWorkspace({ live, onChanged }: { live: WorkspaceView; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [path, setPath] = useState("")
  const edit = async (key: string, change: Parameters<typeof workspaceApi.edit>[1], done?: string) => {
    setBusy(key)
    try {
      await workspaceApi.edit(null, change)
      if (done) toast.success(done)
      onChanged()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    } finally {
      setBusy(null)
    }
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!path.trim()) return
    if (await edit("add", { add: path.trim() }, "Repo added. Restart to work on it.")) setPath("")
  }

  return (
    <div className="space-y-5">
      {live.restartNeeded && (
        <Callout tone="warning" title="Restart to apply">
          <p>The workspace&apos;s repos changed since AgentRoom started. Stop it and run:</p>
          <div className="mt-2">
            <Command text={`agentroom start --workspace ${live.name}`} />
          </div>
        </Callout>
      )}
      <section className="space-y-2" aria-labelledby="ws-repos">
        <h3 id="ws-repos" className="text-sm font-medium">
          Repos <span className="font-normal text-muted-foreground tabular-nums">{live.repos.length}</span>
        </h3>
        <ul className="divide-y rounded-xl border">
          {live.repos.map((r) => (
            <li key={r.id} className="space-y-2.5 px-3 py-3">
              <div className="flex items-center gap-3">
                <FolderGit2Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="truncate font-medium">{r.name}</span>
                    {r.primary && (
                      <ToneBadge size="sm" tone="brand">
                        Primary
                      </ToneBadge>
                    )}
                    {r.branch && <span className="truncate font-mono text-xs text-muted-foreground">{r.branch}</span>}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{r.root}</span>
                </span>
                {!r.primary && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`More for ${r.name}`} disabled={!!busy}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => edit(`primary:${r.id}`, { primary: r.id }, `${r.name} will host the team after a restart.`)}>
                        <StarIcon /> Make primary
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => edit(`remove:${r.id}`, { remove: r.id }, `${r.name} removed. Restart to apply.`)}>
                        <Trash2Icon /> Remove from workspace
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <AppFields repo={r.id} devCommand={r.devCommand} url={r.url} onSave={(change) => edit(`app:${r.id}`, { repo: r.id, ...change }, "Saved")} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          The primary repo hosts the team, board, settings and budgets. Security scans, risk and PR gates cover every repo a goal changes.
        </p>
      </section>

      <form onSubmit={add} className="space-y-1.5" aria-labelledby="ws-add">
        <Label id="ws-add" htmlFor="ws-add-path" className="text-sm font-medium">
          Add a repo
        </Label>
        <div className="flex gap-2">
          <Input id="ws-add-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/code/api" className="font-mono text-xs" autoComplete="off" spellCheck={false} />
          <Button type="submit" disabled={!path.trim() || busy === "add"}>
            {busy === "add" ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <FolderPlusIcon data-icon="inline-start" />}
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">A git checkout on this machine, not inside another repo of the workspace.</p>
      </form>
    </div>
  )
}

/** How QA runs a repo's app. Saved when you leave the field; applies right away. */
function AppFields({ repo, devCommand, url, onSave }: { repo: string; devCommand?: string; url?: string; onSave: (change: { devCommand?: string; url?: string }) => void }) {
  const [cmd, setCmd] = useState(devCommand ?? "")
  const [link, setLink] = useState(url ?? "")
  return (
    <div className="grid gap-2 pl-7 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={`ws-cmd-${repo}`} className="text-xs text-muted-foreground">
          Dev command
        </Label>
        <Input
          id={`ws-cmd-${repo}`}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onBlur={() => cmd.trim() !== (devCommand ?? "") && onSave({ devCommand: cmd.trim() })}
          placeholder="npm run dev"
          className="font-mono text-xs"
          spellCheck={false}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`ws-url-${repo}`} className="text-xs text-muted-foreground">
          App URL
        </Label>
        <Input
          id={`ws-url-${repo}`}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onBlur={() => link.trim() !== (url ?? "") && onSave({ url: link.trim() })}
          placeholder="http://localhost:3000"
          className="font-mono text-xs"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

function CreateWorkspace({ projectRoot, onCreated }: { projectRoot: string; onCreated: () => void }) {
  const [name, setName] = useState("")
  const [paths, setPaths] = useState(`${projectRoot}\n`)
  const [busy, setBusy] = useState(false)
  const [start, setStart] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const list = paths
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean)
      const res = await workspaceApi.create({ name: name.trim(), paths: list })
      setStart(res.start)
      onCreated()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (start) {
    return (
      <Callout tone="success" title="Workspace created">
        <p>Stop AgentRoom and start it on the workspace:</p>
        <div className="mt-2">
          <Command text={start} />
        </div>
      </Callout>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Create a workspace">
      <p className="text-sm text-muted-foreground">
        Work on several repos as one, like a web app and its API: one team, one board, one map, and a linked pull request per repo. The first repo hosts the team.
      </p>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="ws-name" className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="shop" pattern="[a-z0-9][a-z0-9-]{0,39}" title="Lowercase letters, digits and dashes" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-paths" className="text-xs text-muted-foreground">
            Repo folders, one per line
          </Label>
          <Textarea id="ws-paths" value={paths} onChange={(e) => setPaths(e.target.value)} rows={3} className="font-mono text-xs" spellCheck={false} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <FolderPlusIcon data-icon="inline-start" />}
          Create workspace
        </Button>
      </div>
    </form>
  )
}
