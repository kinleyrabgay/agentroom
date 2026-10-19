"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HistoryIcon, PauseIcon, PlayIcon, RotateCwIcon, UserIcon } from "lucide-react"
import type { GoalTimeline as Timeline, TimelineKind, TimelineMarkerKind } from "@shared"
import { cn } from "@/lib/utils"
import { insightsApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Segmented } from "@/components/kit/segmented"
import { EmptyState, ErrorState } from "@/components/kit/state-view"
import { clock, usd } from "@/features/insights/lib/format"

const HUMAN = "human"
/** At 1× a replay never takes longer than this; 4× and 16× go faster. */
const BASE_REPLAY_MS = 120_000
type Speed = "1" | "4" | "16"

const KIND: Record<TimelineKind, { label: string; className: string }> = {
  planning: { label: "Planning", className: "bg-info" },
  working: { label: "Working", className: "bg-brand" },
  security: { label: "Security review", className: "bg-chart-4" },
  testing: { label: "Testing", className: "bg-success" },
  reporting: { label: "Report", className: "bg-muted-foreground/60" },
  waiting: { label: "Waiting on you", className: "bg-warning" },
  error: { label: "Error", className: "bg-danger" },
}

const MARKER: Record<TimelineMarkerKind, string> = {
  approval: "bg-warning",
  checkpoint: "bg-brand",
  delegation: "bg-info",
  failure: "bg-danger",
  pr: "bg-success",
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Replay of one goal: a lane per bot (and one for time spent waiting on you), markers for approvals,
 * hand-offs, commits, PRs and failures, and a playhead with the running cost. Drag or use ←/→ to scrub.
 */
export function GoalTimeline({ goalId }: { goalId: string }) {
  const [data, setData] = useState<Timeline | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      insightsApi
        .timeline(goalId)
        .then((t) => {
          setData(t)
          setError(null)
        })
        .catch((e: Error) => setError(e.message)),
    [goalId]
  )
  useEffect(() => {
    void load()
  }, [load])

  if (error && !data) return <ErrorState error={error} onRetry={() => void load()} />
  if (!data) return <Skeleton className="h-56 w-full rounded-xl" />
  if (!data.lanes.length) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="Nothing to replay yet"
        description="Once bots start working on this goal, every run, approval and hand-off shows up here on a timeline."
        compact
      />
    )
  }
  return <Player key={`${data.goalId}:${data.end}`} data={data} onRefresh={() => void load()} />
}

function Player({ data, onRefresh }: { data: Timeline; onRefresh: () => void }) {
  const bots = useAppStore((s) => s.bots)
  const span = Math.max(1, data.end - data.start)
  const [t, setT] = useState(span)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>("1")
  const trackRef = useRef<HTMLDivElement>(null)

  // Playback: advance the playhead; reduced motion steps once a second instead of every frame.
  useEffect(() => {
    if (!playing) return
    const rate = Math.max(1, span / BASE_REPLAY_MS) * Number(speed)
    let last = performance.now()
    let id = 0
    const tick = (now: number) => {
      const dt = now - last
      last = now
      setT((x) => {
        const next = Math.min(span, x + dt * rate)
        if (next >= span) setPlaying(false)
        return next
      })
      if (reducedMotion()) id = window.setTimeout(() => tick(performance.now()), 1000)
      else id = requestAnimationFrame(tick)
    }
    if (reducedMotion()) id = window.setTimeout(() => tick(performance.now()), 1000)
    else id = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(id)
      clearTimeout(id)
    }
  }, [playing, speed, span])

  const at = data.start + t
  const costSoFar = useMemo(() => {
    let sum = 0
    for (const l of data.lanes) {
      for (const s of l.segments) {
        if (!s.costUsd) continue
        const share = Math.min(1, Math.max(0, (at - s.start) / Math.max(1, s.end - s.start)))
        sum += s.costUsd * share
      }
    }
    return sum
  }, [data.lanes, at])

  const near = useMemo(() => data.events.filter((e) => e.ts <= at).slice(-8).reverse(), [data.events, at])
  const pctAt = (ts: number) => ((ts - data.start) / span) * 100

  const scrubTo = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setT(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    setPlaying(false)
    scrubTo(e.clientX)
    const move = (ev: PointerEvent) => scrubTo(ev.clientX)
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const step = span * (e.shiftKey ? 0.1 : 0.01)
    if (e.key === "ArrowRight") setT((x) => Math.min(span, x + step))
    else if (e.key === "ArrowLeft") setT((x) => Math.max(0, x - step))
    else if (e.key === "Home") setT(0)
    else if (e.key === "End") setT(span)
    else if (e.key === " ") setPlaying((p) => !p)
    else return
    e.preventDefault()
  }

  const play = () => {
    if (t >= span) setT(0)
    setPlaying(!playing)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={play} aria-label={playing ? "Pause replay" : "Play replay"}>
          {playing ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Segmented<Speed>
          size="sm"
          aria-label="Replay speed"
          value={speed}
          onChange={setSpeed}
          options={[
            { value: "1", label: "1×" },
            { value: "4", label: "4×" },
            { value: "16", label: "16×" },
          ]}
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {clock(t)} / {clock(span)} · {usd(costSoFar)} so far of {usd(data.totalCostUsd)}
        </span>
        <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={onRefresh} aria-label="Refresh timeline">
          <RotateCwIcon />
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-3">
        <div className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2">
          {/* Ruler with markers */}
          <span />
          <div className="relative h-4" aria-hidden>
            {data.markers.map((m, i) => (
              <span
                key={`${m.ts}-${i}`}
                title={m.label}
                className={cn("absolute top-1 size-2 -translate-x-1/2 rounded-full ring-2 ring-card", MARKER[m.kind])}
                style={{ left: `${pctAt(m.ts)}%` }}
              />
            ))}
          </div>

          {data.lanes.map((lane) => {
            const bot = bots.find((b) => b.id === lane.botId)
            return (
              <Lane key={lane.botId} label={lane.botId === HUMAN ? "You" : (bot?.name ?? lane.botId)} avatar={lane.botId === HUMAN ? null : bot}>
                {lane.segments.map((s, i) => (
                  <span
                    key={i}
                    title={`${s.label}${s.costUsd ? ` · ${usd(s.costUsd)}` : ""}`}
                    className={cn("absolute top-1 h-4 rounded-[4px]", KIND[s.kind].className, s.start > at && "opacity-35")}
                    style={{ left: `${pctAt(s.start)}%`, width: `max(3px, ${((s.end - s.start) / span) * 100}%)` }}
                  />
                ))}
              </Lane>
            )
          })}
        </div>

        {/* Scrub area over the tracks: playhead line, drag, keyboard. */}
        <div className="mt-1 grid grid-cols-[7.5rem_1fr] gap-x-3">
          <span className="text-xs text-muted-foreground">{new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Replay position"
            aria-valuemin={0}
            aria-valuemax={Math.round(span / 1000)}
            aria-valuenow={Math.round(t / 1000)}
            aria-valuetext={`${clock(t)} of ${clock(span)}`}
            onPointerDown={onPointerDown}
            onKeyDown={onKey}
            className="relative h-5 cursor-ew-resize rounded-full bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span className="absolute inset-y-0 left-0 rounded-full bg-brand/25" style={{ width: `${(t / span) * 100}%` }} />
            <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-surface shadow-xs" style={{ left: `${(t / span) * 100}%` }} />
          </div>
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {(Object.keys(KIND) as TimelineKind[]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className={cn("h-2.5 w-4 rounded-[3px]", KIND[k].className)} aria-hidden />
              {KIND[k].label}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border bg-card">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">At {clock(t)}: latest activity</p>
        {near.length ? (
          <ul className="divide-y">
            {near.map((e, i) => {
              const bot = e.botId ? bots.find((b) => b.id === e.botId) : undefined
              return (
                <li key={`${e.ts}-${i}`} className="flex items-start gap-2.5 px-4 py-2 text-sm">
                  {bot ? <BotAvatar bot={bot} className="mt-0.5 size-5 rounded-md text-[12px]" /> : <UserIcon className="mt-0.5 size-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 break-words">{e.text}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{clock(e.ts - data.start)}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">Nothing yet at this point. Press Play or drag the playhead.</p>
        )}
      </div>
    </div>
  )
}

function Lane({ label, avatar, children }: { label: string; avatar: Parameters<typeof BotAvatar>[0]["bot"] | null | undefined; children: React.ReactNode }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        {avatar ? <BotAvatar bot={avatar} className="size-5 rounded-md text-[12px]" /> : <UserIcon className="size-4 text-muted-foreground" />}
        <span className="truncate">{label}</span>
      </span>
      <div className="relative h-6 rounded-md bg-sunken">{children}</div>
    </>
  )
}
