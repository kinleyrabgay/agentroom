"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowRightIcon, GitPullRequestIcon, Loader2Icon, ShieldAlertIcon } from "lucide-react"
import { toast } from "sonner"
import type { PrReview } from "@shared"
import { cn } from "@/lib/utils"
import { reviewApi } from "@/lib/api/intake-endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Dropdown } from "@/components/kit/dropdown"
import { ToneBadge } from "@/components/kit/badge"
import { RepoBadge } from "@/features/workspaces/components/repo-badge"
import { Callout } from "@/components/kit/callout"
import { EmptyState } from "@/components/kit/state-view"
import { isRunning, loadReviews, putReview, setReviews, useReviewStore } from "../lib/review-store"
import { REVIEW_STATE } from "../lib/meta"
import { ReviewDetail } from "./review-detail"

const POLL_MS = 3000
const AUTO = "__auto__"

/** PR reviews: paste a link, the Reviewer drafts comments, you edit and post. Nothing reaches GitHub before Post. */
export function ReviewsPage() {
  const openId = useReviewStore((s) => s.openId)
  const reviews = useReviewStore((s) => s.reviews)
  const running = reviews.some(isRunning)

  useEffect(() => {
    void loadReviews()
  }, [])
  // Poll only while a review is being prepared or written.
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void loadReviews(), POLL_MS)
    return () => clearInterval(t)
  }, [running])

  if (openId) return <ReviewDetail id={openId} />
  return <ReviewList />
}

function ReviewList() {
  const reviews = useReviewStore((s) => s.reviews)
  const loaded = useReviewStore((s) => s.loaded)
  const error = useReviewStore((s) => s.error)

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-6 pt-6 pb-24">
        <StartReview />
        {error && <Callout tone="warning" title="Couldn't load reviews">{error}</Callout>}
        {!loaded ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="rounded-2xl border border-dashed">
            <EmptyState
              icon={GitPullRequestIcon}
              title="No reviews yet"
              description="Paste a pull request link above. The Reviewer checks it out in its own folder, reads the diff and drafts comments for you to edit."
            />
          </div>
        ) : (
          <ul className="overflow-hidden rounded-xl border bg-card">
            {reviews.map((r) => (
              <ReviewRow key={r.id} review={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StartReview() {
  const bots = useAppStore((s) => s.bots)
  const [url, setUrl] = useState("")
  const [botId, setBotId] = useState(AUTO)
  const [busy, setBusy] = useState(false)
  const botOptions = useMemo(() => [{ value: AUTO, label: "Reviewer (default)" }, ...bots.map((b) => ({ value: b.id, label: b.name, sublabel: b.role }))], [bots])

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true)
    try {
      const r = await reviewApi.start(url.trim(), botId === AUTO ? undefined : botId)
      putReview(r)
      setUrl("")
      setReviews({ openId: r.id })
      toast.success(`Reviewing #${r.number}`, { description: "Nothing is posted until you click Post." })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={start} className="space-y-3 rounded-2xl border bg-card p-5 shadow-xs">
      <div>
        <h2 className="text-base font-semibold">Review a pull request</h2>
        <p className="text-sm text-muted-foreground">A bot drafts the review; you edit every comment and decide whether to post it.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo/pull/123" aria-label="Pull request link" className="flex-1 font-mono text-xs" autoFocus />
        <div className="sm:w-52">
          <Dropdown<string> datas={botOptions} selectedValue={botId} onSelect={(v) => setBotId(v as string)} showSearch={botOptions.length > 8} />
        </div>
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null} Review <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </form>
  )
}

function ReviewRow({ review: r }: { review: PrReview }) {
  const st = REVIEW_STATE[r.state]
  return (
    <li className="relative flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent/40">
      <button type="button" className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset" onClick={() => setReviews({ openId: r.id })} aria-label={`Open review of #${r.number}`} />
      <GitPullRequestIcon className="pointer-events-none relative size-4 shrink-0 text-muted-foreground" />
      <span className="pointer-events-none relative min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          <span className="font-mono text-xs text-muted-foreground">#{r.number}</span> {r.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {r.repo} · @{r.author} · {r.headRef} → {r.baseRef}
        </span>
      </span>
      <RepoBadge task={{ repo: r.workspaceRepo }} className="pointer-events-none relative" />
      {r.fork && <ToneBadge size="sm" tone="warning" icon={ShieldAlertIcon} className="pointer-events-none relative">Fork</ToneBadge>}
      {r.state === "ready" && <span className="pointer-events-none relative hidden text-xs text-muted-foreground sm:inline">{r.comments.length} comments</span>}
      <ToneBadge size="sm" tone={st.tone} dot pulse={isRunning(r)} className="pointer-events-none relative">
        {st.label}
      </ToneBadge>
      <span className={cn("pointer-events-none relative hidden w-16 text-right text-xs text-muted-foreground tabular-nums md:inline")}>{timeAgo(Date.parse(r.updatedAt))}</span>
    </li>
  )
}
