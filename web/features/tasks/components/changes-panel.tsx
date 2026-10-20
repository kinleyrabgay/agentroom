"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { FileDiffIcon, GitCommitHorizontalIcon, Loader2Icon, MessageSquarePlusIcon, RotateCcwIcon, RotateCwIcon, SendIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"
import type { ChangedFile, Goal, GoalChanges, ReviewComment } from "@shared"
import { cn } from "@/lib/utils"
import { goalWorkApi } from "@/lib/api/endpoints"
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
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { EmptyState, ErrorState, LoadingState } from "@/components/kit/state-view"
import { Segmented } from "@/components/kit/segmented"
import { TONE_CLASS, type Tone } from "@/components/kit/tone"
import { parseDiff, toSplit, type DiffLine } from "../lib/diff-lines"

const STATUS: Record<ChangedFile["status"], { letter: string; tone: Tone; label: string }> = {
  added: { letter: "A", tone: "success", label: "Added" },
  modified: { letter: "M", tone: "info", label: "Modified" },
  deleted: { letter: "D", tone: "danger", label: "Deleted" },
  renamed: { letter: "R", tone: "brand", label: "Renamed" },
}

type Mode = "unified" | "split"

/** The goal's diff like a pull request: files by task, inline comments, revert a task, send comments back. */
export function ChangesPanel({ goal, repo }: { goal: Goal; /** Multi-repo workspaces: which of the goal's repos (unset = primary). */ repo?: string }) {
  const [data, setData] = useState<GoalChanges | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("unified")
  const [reload, setReload] = useState(0)
  const commitsKey = useAppStore((s) =>
    s.tasks
      .filter((t) => t.goalId === goal.id)
      .map((t) => `${t.id}:${t.commits.length}:${t.reverted ? 1 : 0}`)
      .join(",")
  )

  useEffect(() => {
    let cancelled = false
    goalWorkApi
      .changes(goal.id, repo)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [goal.id, repo, commitsKey, reload, goal.status])

  const file = data?.files.find((f) => f.path === selected) ?? data?.files[0]
  const pending = goal.reviewComments.filter((c) => !c.sent && !c.resolved)

  if (error) return <ErrorState title="Couldn't read the changes" error={error} onRetry={() => setReload((n) => n + 1)} />
  if (!data) return <LoadingState label="Reading the goal's changes…" />
  if (!data.base) return <EmptyState compact icon={FileDiffIcon} title="No changes yet" description="Changes appear here once the Developer starts building." />
  if (!data.files.length)
    return (
      <EmptyState
        compact
        icon={FileDiffIcon}
        title="No changes yet"
        description={`Nothing differs from ${data.base.slice(0, 8)}${data.branch ? ` on ${data.branch}` : ""}.`}
        action={<Button size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}><RotateCwIcon data-icon="inline-start" /> Refresh</Button>}
      />
    )

  const commentsOf = (path: string) => goal.reviewComments.filter((c) => c.file === path)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-surface">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{data.files.length} {data.files.length === 1 ? "file" : "files"}</span>
            <span className="tone-success tone-text tabular-nums">+{data.additions}</span>
            <span className="tone-danger tone-text tabular-nums">−{data.deletions}</span>
            <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Refresh changes" onClick={() => setReload((n) => n + 1)}>
              <RotateCwIcon />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">By task</p>
            <ul className="space-y-1">
              {data.groups.map((g) => (
                <li key={`${g.taskId ?? g.title}`} className="rounded-xl px-2 py-1.5 hover:bg-accent/50">
                  <button className="flex w-full items-start gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60" onClick={() => g.files[0] && setSelected(g.files[0])}>
                    <GitCommitHorizontalIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", g.reverted && "text-muted-foreground line-through")}>
                        {g.taskId ? <span className="font-mono text-xs text-muted-foreground">{g.taskId} </span> : null}
                        {g.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {g.files.length} {g.files.length === 1 ? "file" : "files"}
                        {g.commits.length > 0 && ` · ${g.commits.length} ${g.commits.length === 1 ? "commit" : "commits"}`}
                      </span>
                    </span>
                  </button>
                  {g.taskId && g.commits.length > 0 && !g.reverted && <RevertTask goal={goal} taskId={g.taskId} onDone={() => setReload((n) => n + 1)} />}
                  {g.reverted && <ToneBadge size="sm" className="mt-1 ml-5.5">Reverted</ToneBadge>}
                </li>
              ))}
            </ul>
            <p className="px-2 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">Files</p>
            <ul>
              {data.files.map((f) => {
                const st = STATUS[f.status]
                const n = commentsOf(f.path).length
                return (
                  <li key={f.path}>
                    <button
                      onClick={() => setSelected(f.path)}
                      aria-current={file?.path === f.path ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/60",
                        file?.path === f.path && "bg-accent"
                      )}
                    >
                      <span className={cn(TONE_CLASS[st.tone], "tone-text w-3 shrink-0 text-center font-mono font-semibold")} title={st.label}>{st.letter}</span>
                      <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>{f.path}</span>
                      {n > 0 && <span className="tone-info tone-soft rounded-full border px-1.5 tabular-nums">{n}</span>}
                      {f.uncommitted && <span className="size-1.5 shrink-0 rounded-full bg-warning" title="Not committed yet" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </aside>

        {file && <FileDiff key={file.path} goal={goal} file={file} comments={commentsOf(file.path)} mode={mode} onMode={setMode} />}
      </div>

      {pending.length > 0 && <RequestChangesBar goal={goal} count={pending.length} />}
    </div>
  )
}

function FileDiff({ goal, file, comments, mode, onMode }: { goal: Goal; file: ChangedFile; comments: ReviewComment[]; mode: Mode; onMode: (m: Mode) => void }) {
  const lines = useMemo(() => parseDiff(file.diff), [file.diff])
  const [commenting, setCommenting] = useState<number | null>(null)
  const byLine = useMemo(() => {
    const m = new Map<number, ReviewComment[]>()
    for (const c of comments) if (c.line) m.set(c.line, [...(m.get(c.line) ?? []), c])
    return m
  }, [comments])
  const general = comments.filter((c) => !c.line)

  const thread = (line: number | undefined) => (
    <>
      {(line ? byLine.get(line) ?? [] : []).map((c) => <CommentCard key={c.id} goal={goal} comment={c} />)}
      {commenting === line && line !== undefined && <CommentBox goal={goal} file={file.path} line={line} onDone={() => setCommenting(null)} />}
    </>
  )

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-surface">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>{file.path}</span>
        {file.uncommitted && <ToneBadge size="sm" tone="warning">Not committed</ToneBadge>}
        <span className="tone-success tone-text text-xs tabular-nums">+{file.additions}</span>
        <span className="tone-danger tone-text text-xs tabular-nums">−{file.deletions}</span>
        <Segmented<Mode> size="sm" aria-label="Diff layout" value={mode} onChange={onMode} options={[{ value: "unified", label: "Unified" }, { value: "split", label: "Split" }]} />
        <Button size="icon-xs" variant="ghost" aria-label="Comment on this file" onClick={() => setCommenting(0)}>
          <MessageSquarePlusIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {(general.length > 0 || commenting === 0) && (
          <div className="space-y-2 border-b p-3">
            {general.map((c) => <CommentCard key={c.id} goal={goal} comment={c} />)}
            {commenting === 0 && <CommentBox goal={goal} file={file.path} onDone={() => setCommenting(null)} />}
          </div>
        )}
        {!lines.length ? (
          <p className="p-4 text-sm text-muted-foreground">No text changes to show (binary file or only a mode change).</p>
        ) : mode === "unified" ? (
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {lines.map((l, i) =>
                l.kind === "hunk" ? (
                  <tr key={i} className="bg-sunken text-muted-foreground">
                    <td colSpan={3} className="px-3 py-1 font-sans text-xs">{l.text}</td>
                  </tr>
                ) : (
                  <Fragment key={i}>
                    <tr className={cn("group", lineTone(l))}>
                      <td className="w-10 px-2 text-right text-muted-foreground/70 select-none">{l.oldNo ?? ""}</td>
                      <td className="w-10 px-2 text-right text-muted-foreground/70 select-none">
                        {l.newNo !== undefined ? (
                          <button
                            className="w-full text-right outline-none group-hover:text-brand-ink focus-visible:text-brand-ink"
                            aria-label={`Comment on line ${l.newNo}`}
                            onClick={() => setCommenting(l.newNo!)}
                          >
                            {l.newNo}
                          </button>
                        ) : null}
                      </td>
                      <td className="px-3 whitespace-pre-wrap break-all">
                        <span className="mr-2 text-muted-foreground select-none">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                        {l.text}
                      </td>
                    </tr>
                    {l.newNo !== undefined && (byLine.has(l.newNo) || commenting === l.newNo) && (
                      <tr>
                        <td colSpan={3} className="space-y-2 bg-sunken/60 px-3 py-2 font-sans">{thread(l.newNo)}</td>
                      </tr>
                    )}
                  </Fragment>
                )
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full table-fixed border-collapse font-mono text-xs leading-5">
            <tbody>
              {toSplit(lines).map((r, i) =>
                r.hunk !== undefined ? (
                  <tr key={i} className="bg-sunken text-muted-foreground">
                    <td colSpan={4} className="px-3 py-1 font-sans text-xs">{r.hunk}</td>
                  </tr>
                ) : (
                  <Fragment key={i}>
                    <tr>
                      <td className={cn("w-10 px-2 text-right text-muted-foreground/70 select-none", r.left && lineTone(r.left === r.right ? r.left : { ...r.left, kind: "del" }))}>{r.left?.oldNo ?? ""}</td>
                      <td className={cn("border-r px-3 whitespace-pre-wrap break-all", r.left && r.left !== r.right && "tone-danger bg-[color-mix(in_oklch,var(--tone)_10%,transparent)]")}>{r.left?.text}</td>
                      <td className="w-10 px-2 text-right text-muted-foreground/70 select-none">
                        {r.right?.newNo !== undefined ? (
                          <button className="w-full text-right outline-none hover:text-brand-ink focus-visible:text-brand-ink" aria-label={`Comment on line ${r.right.newNo}`} onClick={() => setCommenting(r.right!.newNo!)}>
                            {r.right.newNo}
                          </button>
                        ) : null}
                      </td>
                      <td className={cn("px-3 whitespace-pre-wrap break-all", r.right && r.left !== r.right && "tone-success bg-[color-mix(in_oklch,var(--tone)_10%,transparent)]")}>{r.right?.text}</td>
                    </tr>
                    {r.right?.newNo !== undefined && (byLine.has(r.right.newNo) || commenting === r.right.newNo) && (
                      <tr>
                        <td colSpan={4} className="space-y-2 bg-sunken/60 px-3 py-2 font-sans">{thread(r.right.newNo)}</td>
                      </tr>
                    )}
                  </Fragment>
                )
              )}
            </tbody>
          </table>
        )}
        {file.truncated && <p className="border-t px-3 py-2 text-xs text-muted-foreground">This diff is long and was cut. Open the file in your editor for the rest.</p>}
      </div>
    </section>
  )
}

function lineTone(l: DiffLine) {
  if (l.kind === "add") return "tone-success bg-[color-mix(in_oklch,var(--tone)_10%,transparent)]"
  if (l.kind === "del") return "tone-danger bg-[color-mix(in_oklch,var(--tone)_10%,transparent)]"
  return ""
}

function CommentCard({ goal, comment: c }: { goal: Goal; comment: ReviewComment }) {
  const remove = () => goalWorkApi.deleteComment(goal.id, c.id).catch((e: Error) => toast.error(e.message))
  return (
    <div className="flex items-start gap-2 rounded-xl border bg-surface px-3 py-2 text-sm">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="whitespace-pre-wrap">{c.body}</p>
        <p className="text-xs text-muted-foreground">
          {c.author.replace(/\s*<.*>$/, "")}
          {c.sent && " · sent to the Developer"}
        </p>
      </div>
      {!c.sent && (
        <Button size="icon-xs" variant="ghost" aria-label="Delete comment" onClick={remove}>
          <Trash2Icon />
        </Button>
      )}
    </div>
  )
}

function CommentBox({ goal, file, line, onDone }: { goal: Goal; file: string; line?: number; onDone: () => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await goalWorkApi.addComment(goal.id, { file, ...(line ? { line } : {}), body: text.trim() })
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
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
          if (e.key === "Escape") onDone()
        }}
        placeholder={line ? `Comment on line ${line}…` : "Comment on this file…"}
        className="min-h-14 text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">⌘ Enter to add</span>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={!text.trim() || busy}>Add comment</Button>
      </div>
    </div>
  )
}

function RevertTask({ goal, taskId, onDone }: { goal: Goal; taskId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const revert = async () => {
    setBusy(true)
    try {
      await goalWorkApi.revertTask(goal.id, taskId)
      toast.success(`${taskId} reverted`)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }
  return (
    <>
      <Button size="xs" variant="ghost" className="mt-1 ml-4 text-muted-foreground" onClick={() => setOpen(true)}>
        <Undo2Icon data-icon="inline-start" /> Revert {taskId}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert {taskId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Adds commits on {goal.worktree?.branch} that undo this task&apos;s changes. Nothing is deleted from history, and your own working copy isn&apos;t touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={revert} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />} Revert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RequestChangesBar({ goal, count }: { goal: Goal; count: number }) {
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      await goalWorkApi.requestChanges(goal.id)
      toast.success("Sent to the Developer", { description: "A fix task was added; QA re-tests afterwards." })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Callout
      tone="info"
      title={`${count} ${count === 1 ? "comment" : "comments"} pending`}
      action={
        <Button size="sm" onClick={send} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />} Request changes from Developer
        </Button>
      }
    >
      They go to the Developer as one fix task; QA re-tests once it&apos;s done.
    </Callout>
  )
}
