"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { AtSignIcon, ClipboardListIcon, Loader2Icon, MessagesSquareIcon, SendIcon, Trash2Icon, UserIcon } from "lucide-react"
import { toast } from "sonner"
import type { Goal, RoomComment, RoomCommentTarget } from "@shared"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Segmented } from "@/components/kit/segmented"
import { ToneBadge } from "@/components/kit/badge"
import { EmptyState, ErrorState } from "@/components/kit/state-view"
import { cn } from "@/lib/utils"
import { roomApi } from "../lib/room-api"
import { canDecide, ROLE_LABEL, useRoomStore } from "../lib/room-store"
import { PersonAvatar } from "./person-avatar"

type Filter = "all" | "plan"
const NO_COMMENTS: RoomComment[] = []

/** A goal's discussion: comments on the goal or its plan, @mentions notify people. */
export function GoalDiscussion({ goal }: { goal: Goal }) {
  const comments = useRoomStore((s) => s.comments[goal.id] ?? NO_COMMENTS)
  const loaded = useRoomStore((s) => goal.id in s.comments)
  const me = useRoomStore((s) => s.me)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")

  useEffect(() => {
    let live = true
    roomApi
      .comments(goal.id)
      .then((list) => live && useRoomStore.setState((s) => ({ comments: { ...s.comments, [goal.id]: list } })))
      .catch((e: Error) => live && setError(e.message))
    // Reading the discussion clears its notifications.
    const unread = useRoomStore.getState().notifications.filter((n) => n.goalId === goal.id && !n.read).map((n) => n.id)
    if (unread.length) {
      roomApi.markRead(unread).catch(() => {})
      useRoomStore.setState((s) => ({ notifications: s.notifications.map((n) => (unread.includes(n.id) ? { ...n, read: true } : n)) }))
    }
    return () => {
      live = false
    }
  }, [goal.id])

  const shown = filter === "plan" ? comments.filter((c) => c.target === "plan") : comments

  if (error && !loaded) return <ErrorState title="Couldn't load the discussion" error={error} />

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium">Discussion</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{comments.length}</span>
        <Segmented<Filter>
          size="sm"
          aria-label="Show comments"
          value={filter}
          onChange={setFilter}
          className="ml-auto"
          options={[
            { value: "all", label: "All" },
            { value: "plan", label: "On the plan" },
          ]}
        />
      </div>

      {!loaded ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Loading…
        </p>
      ) : shown.length === 0 ? (
        <EmptyState
          compact
          icon={MessagesSquareIcon}
          title={filter === "plan" ? "No comments on the plan yet" : "No comments yet"}
          description="Ask a question, flag a concern before you approve, or @mention someone to bring them in."
          className="rounded-xl border border-dashed"
        />
      ) : (
        <ol className="space-y-3">
          {shown.map((c) => (
            <CommentItem key={c.id} comment={c} canDelete={!!me && (me.role === "owner" || me.id === c.author.id)} />
          ))}
        </ol>
      )}

      {canDecide(me) ? (
        <Composer goal={goal} />
      ) : (
        <p className="rounded-xl border bg-surface px-4 py-3 text-sm text-muted-foreground">You&apos;re a viewer in this room, so you can read the discussion but not post.</p>
      )}
    </div>
  )
}

function CommentItem({ comment: c, canDelete }: { comment: RoomComment; canDelete: boolean }) {
  const remove = () => roomApi.removeComment(c.id).catch((e: Error) => toast.error(e.message))
  return (
    <li className="group flex gap-3">
      <PersonAvatar name={c.author.name} email={c.author.email} className="mt-0.5" />
      <div className="min-w-0 flex-1 rounded-2xl border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{c.author.name}</span>
          <ToneBadge size="sm" tone={c.author.role === "owner" ? "brand" : c.author.role === "approver" ? "info" : "neutral"}>
            {ROLE_LABEL[c.author.role]}
          </ToneBadge>
          {c.target === "plan" && (
            <ToneBadge size="sm" icon={ClipboardListIcon}>
              On the plan
            </ToneBadge>
          )}
          <time dateTime={c.createdAt} className="text-xs text-muted-foreground" title={new Date(c.createdAt).toLocaleString()}>
            {timeAgo(Date.parse(c.createdAt))}
          </time>
          {canDelete && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={remove}
              aria-label="Delete comment"
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
          <WithMentions text={c.body} />
        </p>
      </div>
    </li>
  )
}

/** Highlight @mentions; everything else is plain text (comments are never rendered as HTML). */
function WithMentions({ text }: { text: string }) {
  const parts = text.split(/(@[\w.-]+)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <span key={i} className="rounded-sm px-0.5 font-medium text-brand">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        )
      )}
    </>
  )
}

function Composer({ goal }: { goal: Goal }) {
  const online = useRoomStore((s) => s.online)
  const me = useRoomStore((s) => s.me)
  const [body, setBody] = useState("")
  const [target, setTarget] = useState<RoomCommentTarget>(goal.plan ? "plan" : "goal")
  const [busy, setBusy] = useState(false)
  const people = useMemo(() => online.filter((p) => p.id !== me?.id), [online, me])

  const mention = (name: string) => {
    const handle = name.split(/\s+/)[0]
    setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${handle} `)
  }

  const submit = async () => {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    try {
      await roomApi.comment(goal.id, text, target)
      setBody("")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border bg-card p-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder="Write a comment. @name to notify someone."
        aria-label="Comment"
        className="min-h-20 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<RoomCommentTarget>
          size="sm"
          aria-label="Comment on"
          value={target}
          onChange={setTarget}
          options={[
            { value: "goal", label: <><UserIcon className="size-3.5" /> Goal</> },
            { value: "plan", label: <><ClipboardListIcon className="size-3.5" /> Plan</> },
          ]}
        />
        {people.length > 0 && (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <AtSignIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {people.slice(0, 5).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => mention(p.name)}
                className={cn("h-6 shrink-0 rounded-full border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none")}
              >
                {p.name.split(/\s+/)[0]}
              </button>
            ))}
          </div>
        )}
        <Button size="sm" className="ml-auto" disabled={busy || !body.trim()} onClick={submit}>
          {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          Comment
        </Button>
      </div>
    </div>
  )
}

/** "Started by Dorji" chip on a goal (only for goals started while the room was in use). */
export function GoalOwnerChip({ goalId }: { goalId: string }) {
  const owner = useRoomStore((s) => s.goalOwners[goalId])
  const me = useRoomStore((s) => s.me)
  if (!owner) return null
  return (
    <ToneBadge title={`Started by ${owner.name} <${owner.email}>`} className="gap-1.5 pl-0.5">
      <PersonAvatar name={owner.name} email={owner.email} className="size-[18px] text-[8px]" />
      {owner.id === me?.id ? "You" : owner.name.split(/\s+/)[0]}
    </ToneBadge>
  )
}

/** Unread discussion count for a goal (tab badge). */
export function useUnreadDiscussion(goalId: string) {
  return useRoomStore((s) => s.notifications.filter((n) => n.goalId === goalId && !n.read).length)
}
