"use client"

import { useState } from "react"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  BotIcon,
  ChevronRightIcon,
  FileCodeIcon,
  FlaskConicalIcon,
  HistoryIcon,
  MessageSquareTextIcon,
  PencilIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ThumbsDownIcon,
  TrashIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { ContextClaim, ContextClaimSection, ContextFileFacts, ContextModuleDetail } from "@shared"
import { cn } from "@/lib/utils"
import { contextApi } from "@/lib/api/endpoints"
import { timeAgo } from "@/lib/time"
import { useAppStore } from "@/lib/store/app-store"
import { DetailSection, InspectorPanel } from "@/components/shared/inspector-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Callout } from "@/components/kit/callout"
import { ToneBadge } from "@/components/kit/badge"
import { CARD_STATUS, moduleName, SECTION_TITLES } from "../lib/meta"
import { askAbout, openModule, putModule, setContext, useContextStore } from "../lib/context-store"
import { startSync } from "../lib/actions"

const peek = (path: string, line?: number) => setContext({ peek: { path, ...(line ? { line } : {}) } })

/** Short name for the Inspector switch. */
export function contextModuleLabel(id: string) {
  const m = useContextStore.getState().graph?.modules.find((x) => x.id === id)
  return m ? moduleName(m) : id
}

/** A module's card in the Inspector: what it is, rules, gotchas, the human's notes and decisions; files and dependencies. */
export function ModuleInspector({ id }: { id: string }) {
  const detail = useContextStore((s) => s.details[id])
  const error = useContextStore((s) => s.detailErrors[id])
  const syncing = useContextStore((s) => !!s.status?.syncing)
  const close = () => openModule(null)

  if (!detail) {
    return error ? (
      <div className="p-5">
        <Callout tone="danger" title="Couldn't load this module" action={<Button size="sm" variant="outline" onClick={close}>Close</Button>}>
          {error}
        </Callout>
      </div>
    ) : (
      <div className="space-y-3 p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    )
  }

  const status = CARD_STATUS[detail.status]
  return (
    <InspectorPanel
      label={`Module ${detail.id}`}
      onClose={close}
      refLine={
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ToneBadge tone={status.tone} dot size="sm" title={status.hint}>
            {status.label}
          </ToneBadge>
          <span className="font-mono">{detail.id}</span>
          {detail.generatedAt && <span title={detail.generatedAt}>· card {timeAgo(Date.parse(detail.generatedAt))}</span>}
        </div>
      }
      title={moduleName(detail)}
      subtitle={
        <p className="font-mono text-xs text-muted-foreground">
          {detail.dir ? `${detail.dir}/` : "./"} · {detail.files} files{detail.tests ? ` · ${detail.tests} tests` : ""}
        </p>
      }
      actions={
        <>
          <Button size="sm" variant={detail.status === "fresh" ? "outline" : "default"} disabled={syncing} onClick={() => startSync({ only: [detail.id] })}>
            <RefreshCwIcon data-icon="inline-start" className={cn(syncing && "animate-spin")} />
            {detail.status === "missing" ? "Write card" : "Regenerate"}
          </Button>
          <AskBot moduleId={detail.id} />
        </>
      }
    >
      <Tabs defaultValue="card" className="gap-0">
        <div className="sticky top-0 z-10 border-b bg-background px-5 pt-2">
          <TabsList variant="line">
            <TabsTrigger value="card">Card</TabsTrigger>
            <TabsTrigger value="files">
              Files <span className="text-muted-foreground tabular-nums">{detail.files}</span>
            </TabsTrigger>
            <TabsTrigger value="deps">
              Dependencies <span className="text-muted-foreground tabular-nums">{detail.uses.length + detail.usedBy.length}</span>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="card" className="space-y-6 px-5 py-5">
          <CardTab d={detail} />
        </TabsContent>
        <TabsContent value="files" className="px-5 py-4">
          <FilesTab d={detail} />
        </TabsContent>
        <TabsContent value="deps" className="space-y-6 px-5 py-5">
          <DepsTab d={detail} />
        </TabsContent>
      </Tabs>
    </InspectorPanel>
  )
}

function AskBot({ moduleId }: { moduleId: string }) {
  const bots = useAppStore((s) => s.bots)
  if (!bots.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <BotIcon data-icon="inline-start" /> Ask a bot
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => askAbout(`In ${moduleId}: `)}>
          <MessageSquareTextIcon /> Ask the codebase
          <span className="ml-auto text-xs text-muted-foreground">read-only</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Opens the chat with this module as context</DropdownMenuLabel>
        {bots.map((b) => (
          <DropdownMenuItem key={b.id} onSelect={() => useAppStore.getState().draftToBot(b.id, `Using context module ${moduleId}: `)}>
            <BotAvatar bot={b} className="size-5 rounded-md text-xs" />
            <span className="truncate">{b.name}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">{b.role}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CardTab({ d }: { d: ContextModuleDetail }) {
  const sections = Object.keys(SECTION_TITLES) as ContextClaimSection[]
  const empty = sections.every((k) => !d.sections[k].length)
  return (
    <>
      {d.staleness && <StaleCallout d={d} />}
      {d.status === "missing" ? (
        <Callout tone="neutral" title="No card yet">
          Bots still get this module’s files, symbols and dependencies. A card adds what the code doesn’t say in one place: entry points, rules and
          gotchas, each pointing at the line it comes from.
        </Callout>
      ) : (
        <p className="text-[15px] leading-relaxed text-pretty">{d.purpose}</p>
      )}
      {!empty &&
        sections.map((k) =>
          d.sections[k].length ? (
            <DetailSection key={k} title={SECTION_TITLES[k]} count={d.sections[k].length}>
              <ul className="space-y-2.5">
                {d.sections[k].map((c, i) => (
                  <ClaimRow key={`${k}-${i}-${c.text}`} moduleId={d.id} section={k} index={i} claim={c} />
                ))}
              </ul>
            </DetailSection>
          ) : null
        )}
      <HumanNotes d={d} />
      <Decisions d={d} />
      {d.rejected.length > 0 && (
        <Collapsible className="rounded-xl border">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
            <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            <span className="flex-1">Marked wrong</span>
            <span className="text-xs text-muted-foreground tabular-nums">{d.rejected.length}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-1.5 border-t px-3 py-2.5 text-xs text-muted-foreground">
              {d.rejected.map((r, i) => (
                <li key={i} className="line-through decoration-muted-foreground/40">
                  {r}
                </li>
              ))}
            </ul>
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">The card writer is told not to repeat these.</p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  )
}

function StaleCallout({ d }: { d: ContextModuleDetail }) {
  const s = d.staleness!
  const what = [s.surfaceChanged ? "its public surface changed" : "", s.brokenCites.length ? `${s.brokenCites.length} references no longer resolve` : ""].filter(Boolean)
  return (
    <Callout tone="warning" title={`The code moved on${d.generatedAtSha ? ` since ${d.generatedAtSha.slice(0, 7)}` : ""}`}>
      <p>Bots are told to check this card against the code{what.length ? `: ${what.join(", ")}` : ""}.</p>
      {s.changedFiles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {s.changedFiles.slice(0, 8).map((f) => (
            <button key={f} onClick={() => peek(f)} className="rounded-md border bg-background/60 px-1.5 py-0.5 font-mono text-[11px] hover:bg-background">
              {f.split("/").pop()}
            </button>
          ))}
          {s.changedFiles.length > 8 && <span className="text-xs">+{s.changedFiles.length - 8}</span>}
        </div>
      )}
    </Callout>
  )
}

function ClaimRow({ moduleId, section, index, claim }: { moduleId: string; section: ContextClaimSection; index: number; claim: ContextClaim }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const reject = async () => {
    setBusy(true)
    try {
      putModule(await contextApi.reject(moduleId, section, index, reason.trim()))
      setOpen(false)
      setReason("")
      toast.success("Removed", { description: "The next card for this module won't say it again." })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="group/claim relative rounded-xl border bg-surface px-3 py-2.5 pr-9">
      <p className="text-sm leading-relaxed">{claim.text}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {claim.cite.map((c) => (
          <button
            key={c.raw}
            onClick={() => c.ok && peek(c.file, c.line)}
            disabled={!c.ok}
            title={c.ok ? `Open ${c.file}${c.line ? `:${c.line}` : ""}` : "This reference no longer resolves"}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-md border bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground",
              !c.ok && "tone-warning tone-soft cursor-not-allowed line-through"
            )}
          >
            <FileCodeIcon className="size-3 shrink-0" />
            <span className="truncate">
              {c.file.split("/").pop()}
              {c.line ? `:${c.line}` : ""}
            </span>
          </button>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="This is wrong"
            title="This is wrong"
            className="absolute top-2 right-2 text-muted-foreground opacity-0 group-hover/claim:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <ThumbsDownIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div>
            <p className="text-sm font-medium">What’s wrong with it?</p>
            <p className="text-xs text-muted-foreground">It’s removed now, and the reason is kept so the next card doesn’t repeat it.</p>
          </div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The pool is per request, not global." className="min-h-20" autoFocus />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={reject} disabled={busy}>
              Remove claim
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </li>
  )
}

function HumanNotes({ d }: { d: ContextModuleDetail }) {
  const [text, setText] = useState(d.humanNotes)
  const [base, setBase] = useState(d.humanNotes)
  const [busy, setBusy] = useState(false)
  // Saved elsewhere (another tab, a teammate's pull): follow it unless you're mid-edit.
  if (d.humanNotes !== base) {
    if (text === base) setText(d.humanNotes)
    setBase(d.humanNotes)
  }
  const dirty = text.trim() !== d.humanNotes.trim()
  const save = async () => {
    setBusy(true)
    try {
      putModule(await contextApi.setNotes(d.id, text))
      toast.success("Saved", { description: "Bots read these as rules for this module." })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <DetailSection title="Rules bots must follow here" icon={ScrollTextIcon} hint="Never overwritten">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"e.g. All SQL goes through db.ts.\nDon't add new exports from index.ts."}
        className="min-h-24 text-sm"
      />
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setText(d.humanNotes)}>
            Discard
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            Save rules
          </Button>
        </div>
      )}
    </DetailSection>
  )
}

function Decisions({ d }: { d: ContextModuleDetail }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const save = async (next: string[]) => {
    try {
      putModule(await contextApi.setDecisions(d.id, next))
      setEditing(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const split = (line: string) => {
    const m = /^(\d{4}-\d{2}-\d{2}) · (.*)$/.exec(line)
    return m ? { date: m[1]!, text: m[2]! } : { date: "", text: line }
  }
  return (
    <DetailSection title="Decisions" icon={HistoryIcon} count={d.decisions.length} hint="Added when a goal changes this module">
      {!d.decisions.length ? (
        <p className="text-sm text-muted-foreground">Nothing yet. When a goal finishes, a line about why this module changed lands here.</p>
      ) : (
        <ol className="space-y-1">
          {[...d.decisions].reverse().map((line, ri) => {
            const i = d.decisions.length - 1 - ri
            const { date, text } = split(line)
            return (
              <li key={`${i}-${line}`} className="group/dec flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/50">
                <span className="w-20 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">{date}</span>
                {editing === i ? (
                  <form
                    className="flex min-w-0 flex-1 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void save(d.decisions.map((x, k) => (k === i ? (date ? `${date} · ${draft}` : draft) : x)))
                    }}
                  >
                    <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8" autoFocus />
                    <Button size="sm" type="submit">
                      Save
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-sm">{text}</span>
                    <span className="flex shrink-0 gap-0.5 opacity-0 group-hover/dec:opacity-100 focus-within:opacity-100">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Edit decision"
                        onClick={() => {
                          setEditing(i)
                          setDraft(text)
                        }}
                      >
                        <PencilIcon />
                      </Button>
                      <Button size="icon-xs" variant="ghost" aria-label="Remove decision" onClick={() => void save(d.decisions.filter((_, k) => k !== i))}>
                        <TrashIcon />
                      </Button>
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </DetailSection>
  )
}

function FilesTab({ d }: { d: ContextModuleDetail }) {
  return (
    <ul className="divide-y">
      {d.fileFacts.map((f) => (
        <FileRow key={f.path} f={f} />
      ))}
    </ul>
  )
}

function FileRow({ f }: { f: ContextFileFacts }) {
  const symbols = f.symbols.filter((s) => s.kind !== "method" || s.exported)
  return (
    <li>
      <Collapsible>
        <div className="flex items-center gap-2 py-2">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left" disabled={!symbols.length}>
            <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90", !symbols.length && "invisible")} />
            {f.isTest ? <FlaskConicalIcon className="size-4 shrink-0 text-muted-foreground" /> : <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate font-mono text-xs">{f.path}</span>
          </CollapsibleTrigger>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{f.lines} lines</span>
          <Button size="xs" variant="ghost" onClick={() => peek(f.path)}>
            Open
          </Button>
        </div>
        <CollapsibleContent>
          <ul className="mb-2 ml-6 space-y-0.5 border-l pl-3">
            {symbols.slice(0, 60).map((s) => (
              <li key={`${s.name}:${s.line}`}>
                <button onClick={() => peek(f.path, s.line)} className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent">
                  <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{s.kind}</span>
                  <span className={cn("shrink-0 font-mono text-xs", !s.exported && "text-muted-foreground")}>{s.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{s.signature}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">:{s.line}</span>
                </button>
              </li>
            ))}
            {symbols.length > 60 && <li className="px-1.5 text-xs text-muted-foreground">…{symbols.length - 60} more</li>}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function DepsTab({ d }: { d: ContextModuleDetail }) {
  return (
    <>
      <ModuleList title="Uses" icon={ArrowDownRightIcon} items={d.uses} empty="Doesn't import other modules." />
      <ModuleList title="Used by" icon={ArrowUpRightIcon} items={d.usedBy} empty="Nothing in the repo imports it." />
      <DetailSection title="Tests" icon={FlaskConicalIcon} count={d.testFiles.length}>
        {!d.testFiles.length ? (
          <p className="text-sm text-muted-foreground">No tests found for this module.</p>
        ) : (
          <ul className="space-y-0.5">
            {d.testFiles.map((t) => (
              <li key={t}>
                <button onClick={() => peek(t)} className="w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-accent">
                  {t}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
    </>
  )
}

function ModuleList({ title, icon, items, empty }: { title: string; icon: React.ComponentType<{ className?: string }>; items: { id: string; weight: number }[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.weight))
  return (
    <DetailSection title={title} icon={icon} count={items.length} hint={items.length ? "imports" : undefined}>
      {!items.length ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((m) => (
            <li key={m.id}>
              <button onClick={() => openModule(m.id)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.id}</span>
                <span className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-brand/60" style={{ width: `${(m.weight / max) * 100}%` }} />
                </span>
                <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{m.weight}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  )
}
