"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Components } from "react-markdown"
import {
  ArrowUpIcon,
  BoxIcon,
  CircleHelpIcon,
  CopyIcon,
  FileCodeIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  PinIcon,
  SquareKanbanIcon,
  TrashIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { ContextAnswerCite, ContextAsk } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Markdown } from "@/components/shared/markdown"
import { ToneBadge } from "@/components/kit/badge"
import { ErrorState } from "@/components/kit/state-view"
import { NewGoalDialog } from "@/features/tasks/components/new-goal-dialog"
import { askQuestion, deleteAsk, loadAsks, pinAsk, useAskStore } from "../lib/ask-store"
import { openModule, setContext, setContextTab, useContextStore } from "../lib/context-store"

const SUGGESTIONS = [
  "What should I read first to understand this codebase?",
  "Where are the HTTP routes defined, and how are they registered?",
  "What happens from startup until the app is ready?",
  "Which parts have no tests?",
]

/** Model id → a short name ("claude-haiku-4-5-20251001" → "Haiku 4.5"). */
function modelName(id: string) {
  const m = /claude-(\w+)-(\d+)-(\d+)/.exec(id)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id
}

/** Ask the codebase: cited answers from the same map bots use. */
export function AskPage() {
  const items = useAskStore((s) => s.items)
  const loadError = useAskStore((s) => s.loadError)
  const pending = useAskStore((s) => s.pending)

  useEffect(() => {
    if (!useAskStore.getState().items) void loadAsks()
  }, [])

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 sm:px-6">
        <AskBox />
        <div className="mt-6 space-y-4">
          {pending.map((p) => (
            <PendingCard key={p.key} question={p.question} startedAt={p.startedAt} />
          ))}
          {loadError && !items ? (
            <ErrorState title="Couldn't load your questions" error={loadError} onRetry={() => void loadAsks()} />
          ) : !items ? (
            <>
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-40 w-full rounded-2xl" />
            </>
          ) : items.length === 0 && !pending.length ? (
            <Suggestions />
          ) : (
            items.map((it) => <AnswerCard key={it.id} item={it} />)
          )}
        </div>
      </div>
    </div>
  )
}

function AskBox() {
  const draft = useContextStore((s) => s.askDraft)
  const model = useAppStore((s) => s.settings?.context.cardModel)
  const [text, setText] = useState("")
  const [seenDraft, setSeenDraft] = useState<number | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  // A question handed over from ⌘K, the Tour or a module: put it in the box (adjusting state while rendering).
  if (draft && draft.at !== seenDraft) {
    setSeenDraft(draft.at)
    setText(draft.text)
  }
  useEffect(() => {
    if (!draft) return
    ref.current?.focus()
    setContext({ askDraft: null })
  }, [draft])

  const submit = () => {
    const q = text.trim()
    if (!q) return
    setText("")
    void askQuestion(q).then((ok) => !ok && setText((t) => t || q))
  }

  return (
    <div className="rounded-2xl border bg-surface p-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey) && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="Ask anything about this codebase…"
        aria-label="Question about the codebase"
        rows={2}
        className="min-h-14 resize-none border-0 bg-transparent px-2.5 py-1.5 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center gap-2 px-1.5 pt-1">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Answers cite the code{model ? ` · ${modelName(model)}` : ""} · usually 1–3¢ · read-only
        </p>
        <Button size="sm" className="rounded-full" onClick={submit} disabled={!text.trim()}>
          Ask <ArrowUpIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

function Suggestions() {
  return (
    <div className="rounded-2xl border border-dashed px-5 py-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessageSquareTextIcon className="size-4 text-muted-foreground" /> Try one of these
      </div>
      <p className="mt-1 text-sm text-muted-foreground">The answer reads the map, the module cards and the code itself, and links every claim to the line it came from.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setContext({ askDraft: { text: s, at: Date.now() } })}
            className="rounded-full border bg-surface px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function PendingCard({ question, startedAt }: { question: string; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.round((now - startedAt) / 1000))
  const step = secs < 4 ? "Reading the map" : secs < 12 ? "Looking at module cards and code" : "Checking the details"
  return (
    <article className="rounded-2xl border bg-surface px-5 py-4" aria-busy>
      <p className="font-medium">{question}</p>
      <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {step}…<span className="tabular-nums">{secs}s</span>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </article>
  )
}

function CiteChip({ cite, label }: { cite: ContextAnswerCite; label?: string }) {
  const where = `${cite.file}${cite.line ? `:${cite.line}` : ""}${cite.endLine ? `-${cite.endLine}` : ""}`
  return (
    <button
      type="button"
      onClick={() => cite.ok && setContext({ peek: { path: cite.file, ...(cite.line ? { line: cite.line } : {}) } })}
      disabled={!cite.ok}
      title={cite.ok ? `Open ${where}` : `${where} doesn't exist in the indexed code`}
      className={cn(
        "mx-0.5 inline-flex max-w-full translate-y-[-1px] items-center gap-1 rounded-md border bg-sunken px-1.5 py-px align-middle font-mono text-[11.5px] text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground",
        !cite.ok && "tone-warning tone-soft cursor-not-allowed line-through"
      )}
    >
      <FileCodeIcon className="size-3 shrink-0" />
      <span className="truncate">{label ?? `${cite.file.split("/").pop()}${cite.line ? `:${cite.line}` : ""}${cite.endLine ? `-${cite.endLine}` : ""}`}</span>
    </button>
  )
}

function AnswerCard({ item }: { item: ContextAsk }) {
  const modules = useContextStore((s) => s.graph?.modules)
  const [goalOpen, setGoalOpen] = useState(false)
  const bad = item.cites.filter((c) => !c.ok).length
  const good = item.cites.length - bad

  // Inline code that is a citation becomes a chip that opens the code.
  const overrides = useMemo<Components>(() => {
    const byRaw = new Map(item.cites.map((c) => [c.raw.trim(), c]))
    return {
      code: ({ className, children }) => {
        const text = String(children ?? "")
        const cite = !className && !text.includes("\n") ? byRaw.get(text.trim()) : undefined
        if (cite) return <CiteChip cite={cite} />
        return <code className={cn("rounded-md border bg-sunken px-1.5 py-0.5 font-mono text-[0.85em]", className)}>{children}</code>
      },
    }
  }, [item.cites])

  const nameOf = (id: string) => modules?.find((m) => m.id === id)?.dir || id
  const goalBrief = `${item.question}\n\nWhat we found (Ask the codebase, ${item.askedAt.slice(0, 10)}):\n${item.answer}`

  return (
    <article className="group/answer rounded-2xl border bg-surface px-5 py-4">
      <header className="flex items-start gap-3">
        <h3 className="min-w-0 flex-1 font-medium leading-snug">{item.question}</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="More actions" className="-mt-0.5 -mr-1.5 text-muted-foreground">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setContext({ askDraft: { text: item.question, at: Date.now() } })}>
              <MessageSquareTextIcon /> Ask again
            </DropdownMenuItem>
            {item.ok && (
              <DropdownMenuItem
                onSelect={() =>
                  void navigator.clipboard.writeText(`${item.question}\n\n${item.answer}`).then(
                    () => toast.success("Copied"),
                    () => toast.error("Couldn't copy")
                  )
                }
              >
                <CopyIcon /> Copy answer
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void deleteAsk(item.id)}>
              <TrashIcon /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span title={new Date(item.askedAt).toLocaleString()}>{timeAgo(Date.parse(item.askedAt))}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">${item.costUsd.toFixed(3)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{Math.max(1, Math.round(item.durationMs / 1000))}s</span>
        <span aria-hidden>·</span>
        <span>{modelName(item.model)}</span>
      </div>

      {!item.ok ? (
        <p className="mt-3 text-sm tone-danger tone-text">{item.error ?? "No answer."}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.unsure ? (
              <ToneBadge tone="warning" icon={CircleHelpIcon} size="sm">
                Not sure: check before relying on it
              </ToneBadge>
            ) : (
              <ToneBadge tone="success" dot size="sm">
                {good} {good === 1 ? "reference" : "references"} checked
              </ToneBadge>
            )}
            {bad > 0 && (
              <ToneBadge tone="warning" size="sm" title="Cited lines that don't exist in the indexed code">
                {bad} {bad === 1 ? "reference doesn't" : "references don't"} check out
              </ToneBadge>
            )}
            {item.pinnedTo && (
              <ToneBadge tone="brand" icon={PinIcon} size="sm">
                Pinned to {nameOf(item.pinnedTo)}
              </ToneBadge>
            )}
          </div>
          <div className="mt-3">
            <Markdown text={item.answer} overrides={overrides} />
          </div>
        </>
      )}

      {item.ok && (
        <footer className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
          {item.modules.length > 0 && (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {item.modules.slice(0, 5).map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    setContextTab("map")
                    openModule(id)
                  }}
                  title="Open this module on the map"
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <BoxIcon className="size-3" /> {nameOf(id)}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={!item.modules.length} title={item.modules.length ? "Keep this as a note bots follow" : "The answer doesn't cite a module"}>
                  <PinIcon data-icon="inline-start" /> Pin to notes
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Add to the notes of…</DropdownMenuLabel>
                {item.modules.slice(0, 8).map((id) => (
                  <DropdownMenuItem key={id} onSelect={() => void pinAsk(item.id, id)}>
                    <BoxIcon /> <span className="truncate font-mono text-xs">{nameOf(id)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={() => setGoalOpen(true)}>
              <SquareKanbanIcon data-icon="inline-start" /> Turn into goal
            </Button>
          </div>
        </footer>
      )}
      <NewGoalDialog open={goalOpen} onOpenChange={setGoalOpen} initialBrief={goalBrief} />
    </article>
  )
}
