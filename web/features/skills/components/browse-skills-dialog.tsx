"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDownToLineIcon, CheckIcon, FileCode2Icon, FileTextIcon, LinkIcon, SearchIcon, ShieldCheckIcon, SparklesIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import type { RegistrySearch, RegistrySkill, SkillPreview } from "@shared"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { Segmented } from "@/components/kit/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/kit/state-view"
import { fileToBase64, registryApi } from "@/features/packs/lib/api"

type Tab = "browse" | "import"
const SEARCH_DEBOUNCE_MS = 300
const compact = new Intl.NumberFormat(undefined, { notation: "compact" })

/** Find skills in registries (or import a file), read them in full, then install into the library. */
export function BrowseSkillsDialog({ open, onOpenChange, initialPreview }: { open: boolean; onOpenChange: (v: boolean) => void; initialPreview?: SkillPreview }) {
  const [tab, setTab] = useState<Tab>("browse")
  const [preview, setPreview] = useState<SkillPreview | null>(initialPreview ?? null)
  const [loading, setLoading] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const open_ = async (label: string, load: () => Promise<SkillPreview>) => {
    setPicked(label)
    setLoading(label)
    setPreviewError(null)
    try {
      setPreview(await load())
    } catch (e) {
      setPreview(null)
      setPreviewError((e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(86vh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Browse skills</DialogTitle>
          <DialogDescription>Read a skill in full before installing it. Nothing in a skill runs on install; installed skills go to the shared library.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
            <div className="px-4 pt-3">
              <Segmented<Tab>
                size="sm"
                aria-label="Find skills"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "browse", label: <><SearchIcon className="size-3.5" /> Registries</> },
                  { value: "import", label: <><UploadIcon className="size-3.5" /> Import</> },
                ]}
              />
            </div>
            {tab === "browse" ? (
              <Results selected={picked} loading={loading} onPick={(r) => open_(r.ref, () => registryApi.preview(r.ref))} />
            ) : (
              <Import busy={!!loading} onFile={(f) => open_(f.name, async () => registryApi.upload(f.name, await fileToBase64(f)))} onRef={(ref) => open_(ref, () => registryApi.preview(ref))} />
            )}
          </div>
          <div className="min-h-0 overflow-y-auto">
            {loading ? (
              <LoadingState label={`Fetching ${loading}…`} className="h-full" />
            ) : previewError ? (
              <ErrorState title="Couldn't open this skill" error={previewError} className="h-full" />
            ) : preview ? (
              <Preview key={preview.id} preview={preview} onInstalled={() => setPreview(null)} />
            ) : (
              <EmptyState icon={SparklesIcon} title="Pick a skill to read it" description="You'll see its full instructions, every file it ships and any warnings before you decide." className="h-full" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Results({ selected, loading, onPick }: { selected: string | null; loading: string | null; onPick: (r: RegistrySkill) => void }) {
  const [q, setQ] = useState("")
  const [data, setData] = useState<RegistrySearch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    const t = setTimeout(() => {
      registryApi
        .search(q)
        .then((r) => id === seq.current && (setData(r), setError(null)))
        .catch((e) => id === seq.current && setError((e as Error).message))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q])

  return (
    <>
      <div className="relative px-4 py-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: react, testing, stripe…" className="pl-9" autoFocus />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {error ? (
          <ErrorState error={error} />
        ) : !data ? (
          <LoadingState label="Searching…" />
        ) : !data.results.length ? (
          <EmptyState compact icon={SearchIcon} title={q.length < 2 ? "Type to search" : "No skills found"} description={q.length < 2 ? "skills.sh needs at least two letters." : "Try another word, or import a file you downloaded."} />
        ) : (
          <ul className="space-y-0.5">
            {data.results.map((r) => (
              <li key={`${r.registry}:${r.ref}`}>
                <button
                  onClick={() => onPick(r)}
                  disabled={!!loading}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60",
                    selected === r.ref && "bg-accent"
                  )}
                  aria-current={selected === r.ref ? "true" : undefined}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs font-medium">{r.name}</span>
                    {r.installed && (
                      <ToneBadge tone="success" size="sm" icon={CheckIcon}>
                        In library
                      </ToneBadge>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{r.registry}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{r.description || r.author || r.origin}</span>
                    {typeof r.installs === "number" && (
                      <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 tabular-nums">
                        <ArrowDownToLineIcon className="size-3" aria-hidden /> {compact.format(r.installs)}
                      </span>
                    )}
                    {r.version && <span className="ml-auto shrink-0 font-mono">{r.version}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {data && data.errors.length > 0 && (
          <p className="px-3 pt-2 text-xs text-muted-foreground" title={data.errors.map((e) => `${e.registry}: ${e.error}`).join("\n")}>
            Not reachable: {data.errors.map((e) => e.registry).join(", ")}
          </p>
        )}
      </div>
    </>
  )
}

function Import({ busy, onFile, onRef }: { busy: boolean; onFile: (f: File) => void; onRef: (ref: string) => void }) {
  const [ref, setRef] = useState("")
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const take = (files: FileList | null) => {
    const f = files?.[0]
    if (f) onFile(f)
  }
  return (
    <div className="space-y-5 overflow-y-auto px-4 py-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          take(e.dataTransfer.files)
        }}
        className={cn("flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors", drag && "border-brand bg-accent")}
      >
        <UploadIcon className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Drop a SKILL.md, .zip or .tgz</p>
        <p className="text-xs text-muted-foreground">Skills you bought or downloaded from a marketplace (Agensi and others) or a teammate.</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          Choose file
        </Button>
        <input ref={input} type="file" accept=".md,.zip,.tgz,.gz,.tar" className="sr-only" onChange={(e) => take(e.target.files)} />
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (ref.trim()) onRef(ref.trim())
        }}
      >
        <label htmlFor="skill-ref" className="text-sm font-medium">
          Or a reference
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <LinkIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="skill-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="github:owner/repo/skill" className="pl-9 font-mono" />
          </div>
          <Button type="submit" size="sm" disabled={busy || !ref.trim()}>
            Open
          </Button>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            <code className="font-mono">github:owner/repo/skill</code>
          </li>
          <li>
            <code className="font-mono">skills-sh:owner/repo/skill</code>
          </li>
          <li>
            <code className="font-mono break-all">https://…/skill.tgz#sha256=…</code>
            <span className="block">The hash is checked when you give one.</span>
          </li>
        </ul>
      </form>
    </div>
  )
}

function Preview({ preview, onInstalled }: { preview: SkillPreview; onInstalled: () => void }) {
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const needsAck = preview.warnings.length > 0 || !!preview.exists
  const others = preview.files.filter((f) => f.path !== "SKILL.md")

  const install = async () => {
    setBusy(true)
    try {
      const r = await registryApi.install(preview.id, !!preview.exists)
      toast.success(`Installed ${r.name}`, { description: "In the shared library. Drag it onto a bot to use it." })
      onInstalled()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-4 px-5 py-4">
        <header className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-base font-semibold">{preview.name}</h3>
            <span className="font-mono text-xs text-muted-foreground">{preview.version}</span>
            {preview.verified ? (
              <ToneBadge tone="success" size="sm" icon={ShieldCheckIcon} title={preview.sha256}>
                Hash matches the registry
              </ToneBadge>
            ) : (
              <ToneBadge size="sm" title={preview.sha256}>
                sha256 {preview.sha256.slice(0, 10)}…
              </ToneBadge>
            )}
          </div>
          {preview.description && <p className="text-sm text-pretty text-muted-foreground">{preview.description}</p>}
          <p className="truncate font-mono text-xs text-muted-foreground" title={preview.source}>
            {preview.source}
          </p>
        </header>

        {preview.warnings.length > 0 && (
          <Callout tone="warning" title="Read these before installing">
            <ul className="space-y-1">
              {preview.warnings.map((w, i) => (
                <li key={i}>
                  <span className="font-medium">{w.label}</span>
                  <span className="block text-xs break-words opacity-90">{w.excerpt}</span>
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {preview.exists && (
          <Callout tone="info" title={`Replaces your ${preview.name}`}>
            {preview.exists.modified ? "Your copy has local edits; they'll be lost." : "Your copy is unchanged since it was installed."}
            {preview.exists.source ? ` Installed from ${preview.exists.source}.` : ""}
          </Callout>
        )}

        <section aria-label="SKILL.md" className="overflow-hidden rounded-xl border">
          <div className="flex items-center gap-2 border-b bg-sunken px-3 py-2 text-xs">
            <FileTextIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="font-mono font-medium">SKILL.md</span>
            <span className="ml-auto text-muted-foreground">What bots will read</span>
          </div>
          <pre className="max-h-96 overflow-auto bg-surface p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{preview.skillMd}</pre>
        </section>

        {others.length > 0 && (
          <section aria-label="Other files" className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">
              {others.length} more file{others.length === 1 ? "" : "s"}
            </h4>
            <ul className="space-y-1.5">
              {others.map((f) => (
                <li key={f.path}>
                  <Collapsible defaultOpen={f.executable} className="overflow-hidden rounded-xl border">
                    <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60">
                      <FileCode2Icon className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="truncate font-mono">{f.path}</span>
                      {f.executable && (
                        <ToneBadge tone="warning" size="sm">
                          Script
                        </ToneBadge>
                      )}
                      <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {f.text !== undefined ? (
                        <pre className="max-h-72 overflow-auto border-t bg-surface p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{f.text}</pre>
                      ) : (
                        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Binary file, not shown.</p>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-3 border-t bg-background/95 px-5 py-3 backdrop-blur">
        {needsAck && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
            I&apos;ve read it{preview.exists ? " and want to replace mine" : ""}
          </label>
        )}
        <Button className="ml-auto" onClick={install} disabled={busy || (needsAck && !ack)}>
          <ArrowDownToLineIcon data-icon="inline-start" /> {busy ? "Installing…" : preview.exists ? "Replace" : "Install"}
        </Button>
      </footer>
    </div>
  )
}
