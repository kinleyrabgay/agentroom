"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckIcon, FileTextIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import type { ContextDiffLine, ContextDocPreview } from "@shared"
import { cn } from "@/lib/utils"
import { contextApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { ToneBadge } from "@/components/kit/badge"
import { ErrorState } from "@/components/kit/state-view"

const ABOUT: Record<ContextDocPreview["id"], string> = {
  architecture: "Overview, a dependency diagram (Mermaid), every module with its purpose, and the key flows: call paths, routes and core modules.",
  decisions: "Every decision recorded on module cards, newest first, and grouped by module.",
}

/** Docs generated from the map. Shown as a diff; written only when you click. */
export function DocsPage() {
  const [docs, setDocs] = useState<ContextDocPreview[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDocs(await contextApi.docs())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let live = true
    contextApi
      .docs()
      .then((d) => live && setDocs(d))
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 pt-6 pb-24 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Docs from the map</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Built from the facts and cards, no model calls. Only the marked sections are regenerated; anything you write outside them stays.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={cn(loading && "animate-spin")} data-icon="inline-start" /> Refresh
          </Button>
        </div>
        <div className="mt-5 space-y-5">
          {error && !docs ? (
            <ErrorState title="Couldn't build the docs" error={error} onRetry={() => void load()} />
          ) : !docs ? (
            <>
              <Skeleton className="h-72 w-full rounded-2xl" />
              <Skeleton className="h-40 w-full rounded-2xl" />
            </>
          ) : (
            docs.map((d) => <DocCard key={d.id} doc={d} onWritten={(next) => setDocs((all) => all?.map((x) => (x.id === next.id ? next : x)) ?? null)} />)
          )}
        </div>
      </div>
    </div>
  )
}

function DocCard({ doc, onWritten }: { doc: ContextDocPreview; onWritten: (d: ContextDocPreview) => void }) {
  const changed = doc.sections.filter((s) => s.changed)
  const [picked, setPicked] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() })
  const [busy, setBusy] = useState(false)
  // Default: every changed section; reset when the preview changes.
  const key = changed.map((s) => s.id).join(",") + `|${doc.added}|${doc.removed}`
  const selected = picked.key === key ? picked.ids : new Set(changed.map((s) => s.id))
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setPicked({ key, ids: next })
  }
  const upToDate = doc.exists && !changed.length

  const write = async () => {
    setBusy(true)
    try {
      const all = !doc.exists || selected.size === changed.length
      const next = await contextApi.writeDoc(doc.id, all ? undefined : [...selected])
      onWritten(next)
      toast.success(`Wrote ${doc.path}`, { description: "Review it, then commit it with your next change." })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-surface">
      <header className="flex flex-wrap items-start gap-3 px-5 pt-4 pb-3">
        <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{doc.path}</span>
            {!doc.exists ? (
              <ToneBadge tone="info" size="sm">New file</ToneBadge>
            ) : upToDate ? (
              <ToneBadge tone="success" icon={CheckIcon} size="sm">Up to date</ToneBadge>
            ) : (
              <ToneBadge tone="warning" size="sm">
                {changed.length} {changed.length === 1 ? "section" : "sections"} changed
              </ToneBadge>
            )}
            {(doc.added > 0 || doc.removed > 0) && (
              <span className="font-mono text-xs tabular-nums">
                <span className="tone-success tone-text">+{doc.added}</span> <span className="tone-danger tone-text">−{doc.removed}</span>
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{ABOUT[doc.id]}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-sunken/50 px-5 py-2.5">
        {doc.sections.map((s) => (
          <label key={s.id} className={cn("inline-flex items-center gap-2 text-sm", !s.changed && "text-muted-foreground")}>
            <Checkbox
              checked={!doc.exists || (s.changed && selected.has(s.id))}
              disabled={!doc.exists || !s.changed || busy}
              onCheckedChange={(v) => toggle(s.id, v === true)}
              aria-label={`Regenerate ${s.title}`}
            />
            {s.title}
            {doc.exists && !s.changed && <span className="text-xs">· same</span>}
          </label>
        ))}
        <div className="ml-auto">
          <Button size="sm" onClick={() => void write()} disabled={busy || upToDate || (doc.exists && !selected.size)}>
            {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            {!doc.exists ? "Write file" : selected.size === changed.length ? "Write changes" : `Write ${selected.size} ${selected.size === 1 ? "section" : "sections"}`}
          </Button>
        </div>
      </div>

      {doc.diff.length > 0 ? <DiffView lines={doc.diff} /> : <p className="border-t px-5 py-4 text-sm text-muted-foreground">Matches the map. Nothing to write.</p>}
    </section>
  )
}

function DiffView({ lines }: { lines: ContextDiffLine[] }) {
  return (
    <div className="max-h-[460px] overflow-auto border-t font-mono text-xs leading-relaxed">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) =>
            l.kind === "gap" ? (
              <tr key={i} className="bg-sunken text-muted-foreground">
                <td colSpan={3} className="px-3 py-1 text-center text-[11px] select-none">
                  ⋯ {l.text}
                </td>
              </tr>
            ) : (
              <tr key={i} className={cn(l.kind === "add" && "tone-success tone-soft", l.kind === "del" && "tone-danger tone-soft")}>
                <td className="w-10 border-r px-2 text-right text-muted-foreground tabular-nums select-none">{l.a ?? ""}</td>
                <td className="w-10 border-r px-2 text-right text-muted-foreground tabular-nums select-none">{l.b ?? ""}</td>
                <td className="px-3 whitespace-pre-wrap break-all">
                  <span className="mr-2 inline-block w-2 select-none opacity-60">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                  {l.text}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  )
}
