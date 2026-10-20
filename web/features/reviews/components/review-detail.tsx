"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { ArrowLeftIcon, ExternalLinkIcon, FolderXIcon, Loader2Icon, MessageSquarePlusIcon, PencilIcon, RotateCwIcon, SendIcon, ShieldAlertIcon, Trash2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { PrReview, PrReviewComment, PrReviewEvent, PrReviewFile } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab } from "@/lib/constants"
import { reviewApi } from "@/lib/api/intake-endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { Markdown } from "@/components/shared/markdown"
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { Segmented } from "@/components/kit/segmented"
import { ErrorState, LoadingState } from "@/components/kit/state-view"
import { TONE_CLASS } from "@/components/kit/tone"
import { parseDiff, type DiffLine } from "@/features/tasks/lib/diff-lines"
import { EVENT_LABEL, REVIEW_STATE, SEVERITY } from "../lib/meta"
import { isRunning, loadReviewDetail, loadReviews, putReview, setReviews, useReviewStore } from "../lib/review-store"

type Side = "RIGHT" | "LEFT"
const key = (path: string, side: Side, line: number) => `${path}:${side}:${line}`

/** One review in full: the PR, the bot's draft (summary + inline comments on the diff), and Post. */
export function ReviewDetail({ id }: { id: string }) {
  const review = useReviewStore((s) => s.reviews.find((r) => r.id === id))
  const detail = useReviewStore((s) => s.details[id])
  const [error, setError] = useState<string | null>(null)
  const back = () => setReviews({ openId: null })

  useEffect(() => {
    if (detail || (review && isRunning(review))) return
    loadReviewDetail(id).catch((e: Error) => setError(e.message))
  }, [id, detail, review])

  if (error && !detail) return <ErrorState title="Couldn't load this review" error={error} onRetry={() => setError(null)} className="h-full" />
  if (!review) return <LoadingState className="h-full" />

  return (
    <div className="absolute inset-0 flex flex-col">
      <Header review={review} onBack={back} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-4 px-6 pt-4 pb-28">
          {isRunning(review) ? (
            <Running review={review} />
          ) : review.state === "failed" ? (
            <Callout tone="danger" title="The review didn't finish" action={<Rerun review={review} />}>
              <span className="break-words">{review.error}</span>
            </Callout>
          ) : !detail ? (
            <LoadingState label="Loading the diff…" />
          ) : (
            <Draft review={review} files={detail.files} />
          )}
        </div>
      </div>
      {review.state === "ready" && detail && <PostBar review={review} />}
    </div>
  )
}

function Header({ review: r, onBack }: { review: PrReview; onBack: () => void }) {
  const st = REVIEW_STATE[r.state]
  const remove = async () => {
    try {
      await reviewApi.remove(r.id)
      onBack()
      await loadReviews()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const cleanup = async () => {
    try {
      putReview(await reviewApi.cleanup(r.id))
      toast.success("Checkout folder removed")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <header className="border-b bg-background/80 px-6 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="All reviews">
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">
              {r.repo}#{r.number}
            </span>
            <span>@{r.author}</span>
            <span className="font-mono">
              {r.headRef} → {r.baseRef}
            </span>
            <span className="tabular-nums">
              <span className="tone-success tone-text">+{r.additions}</span> <span className="tone-danger tone-text">−{r.deletions}</span>
            </span>
          </p>
          <h2 className="truncate text-lg font-semibold tracking-tight">{r.title}</h2>
        </div>
        <ToneBadge tone={st.tone} dot pulse={isRunning(r)}>
          {st.label}
        </ToneBadge>
        {r.fork && (
          <ToneBadge tone="warning" icon={ShieldAlertIcon} title={r.allowScripts ? "You allowed this fork's scripts" : "Commands from this fork need your approval"}>
            Fork{r.allowScripts ? " · scripts allowed" : ""}
          </ToneBadge>
        )}
        <Button asChild size="sm" variant="outline">
          <a href={r.url} target="_blank" rel="noreferrer noopener">
            <ExternalLinkIcon data-icon="inline-start" /> GitHub
          </a>
        </Button>
        {!isRunning(r) && r.state !== "posted" && <Rerun review={r} />}
        {!isRunning(r) && r.worktree && (
          <Button size="icon-sm" variant="ghost" onClick={cleanup} aria-label="Remove the checkout folder" title="Remove the checkout folder">
            <FolderXIcon />
          </Button>
        )}
        {!isRunning(r) && <ConfirmDelete title={`Delete the review of #${r.number}?`} description="Removes the draft from AgentRoom. Anything already posted stays on GitHub." onConfirm={remove} />}
      </div>
    </header>
  )
}

function Rerun({ review: r }: { review: PrReview }) {
  const [busy, setBusy] = useState(false)
  const run = async (allowScripts: boolean) => {
    setBusy(true)
    try {
      putReview(await reviewApi.rerun(r.id, allowScripts))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {r.fork && !r.allowScripts && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(true)} title="Lets the Reviewer run this fork's tests and scripts (each command still asks)">
          Allow scripts and re-run
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => run(false)}>
        <RotateCwIcon data-icon="inline-start" /> Re-run
      </Button>
    </>
  )
}

function Running({ review: r }: { review: PrReview }) {
  const select = useAppStore((s) => s.select)
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
      <Loader2Icon className="size-6 animate-spin text-brand" />
      <div>
        <p className="font-medium">{r.state === "preparing" ? "Checking out the pull request…" : "The Reviewer is reading the diff…"}</p>
        <p className="text-sm text-muted-foreground">It works in its own folder. Nothing is posted until you click Post.</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => select(r.botId, BotTab.Activity)}>
        Watch it work
      </Button>
    </div>
  )
}

function Draft({ review: r, files }: { review: PrReview; files: PrReviewFile[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const posted = r.state === "posted"
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of r.comments) m.set(c.path, (m.get(c.path) ?? 0) + 1)
    return m
  }, [r.comments])
  const file = files.find((f) => f.path === selected) ?? files.find((f) => counts.has(f.path)) ?? files[0]

  const saveComments = async (comments: PrReviewComment[]) => {
    try {
      putReview(await reviewApi.update(r.id, { comments }))
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  return (
    <>
      {posted && (
        <Callout tone="success" title={`Posted as ${EVENT_LABEL[r.postedEvent ?? "COMMENT"].toLowerCase()}`}>
          {r.postedBy?.replace(/\s*<.*>$/, "")} posted this review{r.postedAt ? ` on ${new Date(r.postedAt).toLocaleString()}` : ""}.
        </Callout>
      )}
      <Summary review={r} />
      <div className="grid min-h-[480px] gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-surface">
          <p className="border-b px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{files.length}</span> files · <span className="font-medium text-foreground">{r.comments.length}</span> comments
          </p>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  onClick={() => setSelected(f.path)}
                  aria-current={file?.path === f.path ? "true" : undefined}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/60", file?.path === f.path && "bg-accent")}
                >
                  <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>
                    {f.path}
                  </span>
                  {counts.get(f.path) ? <span className="tone-info tone-soft rounded-full border px-1.5 tabular-nums">{counts.get(f.path)}</span> : null}
                  <span className="tone-success tone-text tabular-nums">+{f.additions}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        {file ? (
          <FileDiff key={file.path} file={file} comments={r.comments} readOnly={posted} onChange={saveComments} />
        ) : (
          <p className="rounded-2xl border p-6 text-sm text-muted-foreground">This pull request has no text changes.</p>
        )}
      </div>
    </>
  )
}

function Summary({ review: r }: { review: PrReview }) {
  const [text, setText] = useState(r.summary)
  const [prev, setPrev] = useState(r.summary)
  if (prev !== r.summary) {
    setPrev(r.summary)
    setText(r.summary)
  }
  const posted = r.state === "posted"
  const save = async () => {
    if (text === r.summary) return
    try {
      putReview(await reviewApi.update(r.id, { summary: text }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const removeNote = async (i: number) => {
    try {
      putReview(await reviewApi.update(r.id, { general: r.general.filter((_, j) => j !== i) }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4" aria-label="Review summary">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Summary</h3>
        <span className="text-xs text-muted-foreground">The review&apos;s main comment on GitHub.</span>
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={save} readOnly={posted} rows={4} className="text-sm" placeholder="What you think of the change overall." />
      {r.general.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Other notes (lines outside the diff; posted under the summary)</p>
          <ul className="space-y-1">
            {r.general.map((g, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-sunken/60 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 break-words">
                  <Markdown text={g} />
                </span>
                {!posted && (
                  <Button size="icon-xs" variant="ghost" aria-label="Remove note" onClick={() => removeNote(i)}>
                    <XIcon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function FileDiff({ file, comments, readOnly, onChange }: { file: PrReviewFile; comments: PrReviewComment[]; readOnly: boolean; onChange: (c: PrReviewComment[]) => Promise<boolean> }) {
  const lines = useMemo(() => parseDiff(file.diff), [file.diff])
  const [adding, setAdding] = useState<{ side: Side; line: number } | null>(null)
  const mine = useMemo(() => comments.filter((c) => c.path === file.path), [comments, file.path])
  const byKey = useMemo(() => {
    const m = new Map<string, PrReviewComment[]>()
    for (const c of mine) m.set(key(c.path, c.side, c.line), [...(m.get(key(c.path, c.side, c.line)) ?? []), c])
    return m
  }, [mine])

  const anchor = (l: DiffLine): { side: Side; line: number } | null => (l.kind === "del" ? { side: "LEFT", line: l.oldNo! } : l.newNo !== undefined ? { side: "RIGHT", line: l.newNo } : null)
  const replace = (id: string, next: PrReviewComment | null) => onChange(comments.flatMap((c) => (c.id === id ? (next ? [next] : []) : [c])))
  const add = async (side: Side, line: number, body: string) => {
    const ok = await onChange([...comments, { id: "", path: file.path, line, side, body, severity: "minor", author: "human" }])
    if (ok) setAdding(null)
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-surface">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
          {file.path}
        </span>
        <span className="tone-success tone-text text-xs tabular-nums">+{file.additions}</span>
        <span className="tone-danger tone-text text-xs tabular-nums">−{file.deletions}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs leading-5">
          <tbody>
            {lines.map((l, i) => {
              if (l.kind === "hunk") {
                return (
                  <tr key={i} className="bg-sunken text-muted-foreground">
                    <td colSpan={3} className="px-3 py-1 font-sans text-xs">
                      {l.text}
                    </td>
                  </tr>
                )
              }
              const a = anchor(l)
              const thread = a ? byKey.get(key(file.path, a.side, a.line)) ?? [] : []
              const open = a && adding && adding.side === a.side && adding.line === a.line
              return (
                <Fragment key={i}>
                  <tr className={cn("group", lineTone(l))}>
                    <td className="w-10 px-2 text-right text-muted-foreground/70 select-none">{l.oldNo ?? ""}</td>
                    <td className="w-10 px-2 text-right text-muted-foreground/70 select-none">
                      {a && !readOnly ? (
                        <button className="w-full text-right outline-none group-hover:text-brand-ink focus-visible:text-brand-ink" aria-label={`Comment on line ${a.line}`} onClick={() => setAdding(a)}>
                          {l.newNo ?? <MessageSquarePlusIcon className="ml-auto size-3" />}
                        </button>
                      ) : (
                        (l.newNo ?? "")
                      )}
                    </td>
                    <td className="px-3 break-all whitespace-pre-wrap">
                      <span className="mr-2 text-muted-foreground select-none">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                      {l.text}
                    </td>
                  </tr>
                  {(thread.length > 0 || open) && (
                    <tr>
                      <td colSpan={3} className="space-y-2 bg-sunken/60 px-3 py-2 font-sans">
                        {thread.map((c) => (
                          <CommentCard key={c.id} comment={c} readOnly={readOnly} onSave={(next) => replace(c.id, next)} onDelete={() => replace(c.id, null)} />
                        ))}
                        {open && a && <CommentBox placeholder={`Comment on line ${a.line}…`} onCancel={() => setAdding(null)} onSave={(body) => add(a.side, a.line, body)} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {file.truncated && <p className="border-t px-3 py-2 text-xs text-muted-foreground">This diff is long and was cut here.</p>}
      </div>
    </section>
  )
}

function lineTone(l: DiffLine) {
  if (l.kind === "add") return "tone-success bg-[color-mix(in_oklch,var(--tone)_10%,transparent)]"
  if (l.kind === "del") return "tone-danger bg-[color-mix(in_oklch,var(--tone)_10%,transparent)]"
  return ""
}

function CommentCard({ comment: c, readOnly, onSave, onDelete }: { comment: PrReviewComment; readOnly: boolean; onSave: (c: PrReviewComment) => Promise<boolean>; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const sev = SEVERITY[c.severity]
  if (editing) return <CommentBox initial={c.body} onCancel={() => setEditing(false)} onSave={async (body) => (await onSave({ ...c, body })) && setEditing(false)} />
  return (
    <div className="flex items-start gap-2 rounded-xl border bg-surface px-3 py-2 text-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn(TONE_CLASS[sev.tone], "tone-soft rounded-full border px-1.5 font-medium")}>{sev.label}</span>
          {c.author === "bot" ? "Drafted by the Reviewer" : "You"}
          {c.side === "LEFT" && " · on removed code"}
        </p>
        <div className="break-words">
          <Markdown text={c.body} />
        </div>
      </div>
      {!readOnly && (
        <div className="flex shrink-0 gap-0.5">
          <Button size="icon-xs" variant="ghost" aria-label="Edit comment" onClick={() => setEditing(true)}>
            <PencilIcon />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Delete comment" onClick={onDelete}>
            <Trash2Icon />
          </Button>
        </div>
      )}
    </div>
  )
}

function CommentBox({ initial = "", placeholder, onCancel, onSave }: { initial?: string; placeholder?: string; onCancel: () => void; onSave: (body: string) => Promise<unknown> }) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!text.trim()) return
    setBusy(true)
    await onSave(text.trim())
    setBusy(false)
  }
  return (
    <div className="space-y-2 rounded-xl border bg-surface p-2">
      <Textarea
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save()
          if (e.key === "Escape") onCancel()
        }}
        placeholder={placeholder}
        className="min-h-14 text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">⌘ Enter to save</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={!text.trim() || busy}>
          Save
        </Button>
      </div>
    </div>
  )
}

function PostBar({ review: r }: { review: PrReview }) {
  const [event, setEvent] = useState<PrReviewEvent>(r.suggestedEvent)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const post = async () => {
    setBusy(true)
    try {
      putReview(await reviewApi.post(r.id, event))
      toast.success(`Review posted on #${r.number}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border bg-popover py-1.5 pr-1.5 pl-4 text-sm shadow-lg">
        <span className="text-muted-foreground">
          {r.comments.length} {r.comments.length === 1 ? "comment" : "comments"} as
        </span>
        <Segmented<PrReviewEvent>
          size="sm"
          aria-label="Review type"
          value={event}
          onChange={setEvent}
          options={(["COMMENT", "REQUEST_CHANGES", "APPROVE"] as const).map((e) => ({ value: e, label: EVENT_LABEL[e] }))}
        />
        <Button size="sm" className="rounded-full" onClick={() => setConfirm(true)}>
          <SendIcon data-icon="inline-start" /> Post review
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post this review to GitHub?</AlertDialogTitle>
            <AlertDialogDescription>
              Posts a “{EVENT_LABEL[event].toLowerCase()}” review with {r.comments.length} inline {r.comments.length === 1 ? "comment" : "comments"} on {r.repo}#{r.number}, as your GitHub account. It can&apos;t be unposted from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={post} disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />} Post review
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
