import { AgentEventType, type Attachment, type StampedEvent, type TurnFileChange } from "@shared"
import type { LiveReply } from "@/lib/store/live-reply"
import { hasInjectionFlag } from "@/features/security/lib/injection"

export const ToolStepState = {
  Preparing: "preparing",
  Running: "running",
  Waiting: "waiting",
  Done: "done",
  Failed: "failed",
} as const
export type ToolStepState = (typeof ToolStepState)[keyof typeof ToolStepState]

export interface ToolStep {
  id: string
  name: string
  summary: string
  state: ToolStepState
  /** The server flagged this tool's output as possible prompt injection. */
  flagged?: boolean
  goalId?: string
  /** Raw call and result, behind the step's own disclosure. */
  input?: unknown
  output?: string
}

export type TranscriptItem =
  | { kind: "user"; key: string; text: string; from: string; attachments: Attachment[]; ts: number }
  | { kind: "text"; key: string; text: string; live?: boolean }
  | { kind: "tools"; key: string; steps: ToolStep[]; live: boolean }
  | { kind: "done"; key: string; ok: boolean; turns: number; durationMs: number; costUsd: number; ts: number }
  | { kind: "error"; key: string; message: string }
  | { kind: "changes"; key: string; files: TurnFileChange[]; skipped: { path: string; reason: string }[] }
  /**
   * A turn's work folded away ("Worked for 2m 10s"): narration and tool calls before the final answer.
   * `startedAt`/`endedAt` time it; `endedAt` is unset while it runs.
   */
  | { kind: "activity"; key: string; items: TranscriptItem[]; startedAt: number; endedAt?: number; live: boolean }

export const isActiveStep = (s: ToolStep) =>
  s.state === ToolStepState.Running || s.state === ToolStepState.Preparing || s.state === ToolStepState.Waiting

/**
 * Fold a bot's events (plus its live stream) into chat items. Consecutive tool calls
 * collapse into one group, like Claude's "Used N tools".
 */
export function buildTranscript(evs: StampedEvent[], live: LiveReply | undefined, running: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const results = new Map<string, boolean>()
  const outputs = new Map<string, string>()
  const flagged = new Set<string>()
  for (const e of evs) {
    if (e.type !== AgentEventType.ToolResult) continue
    results.set(e.toolUseId, e.ok)
    outputs.set(e.toolUseId, e.output)
    if (hasInjectionFlag(e.output)) flagged.add(e.toolUseId)
  }

  // A tool is waiting on the human when the latest permission request (by summary) is unanswered.
  let waitingSummary: string | null = null
  for (const e of evs) {
    if (e.type === AgentEventType.PermissionRequest) waitingSummary = e.summary
    if (e.type === AgentEventType.PermissionResolved) waitingSummary = null
  }

  const lastGroup = () => {
    const last = items.at(-1)
    return last?.kind === "tools" ? last : null
  }
  const addStep = (step: ToolStep, key: string, live: boolean) => {
    const group = lastGroup()
    if (group) group.steps.push(step)
    else items.push({ kind: "tools", key, steps: [step], live })
  }

  for (const e of evs) {
    switch (e.type) {
      case AgentEventType.UserMessage:
        items.push({ kind: "user", key: `u${e.seq}`, text: e.text, from: e.from, attachments: e.attachments ?? [], ts: e.ts })
        break
      case AgentEventType.Message:
        items.push({ kind: "text", key: `m${e.seq}`, text: e.text })
        break
      case AgentEventType.ToolCall: {
        const ok = results.get(e.toolUseId)
        const state =
          ok === undefined
            ? waitingSummary === e.summary
              ? ToolStepState.Waiting
              : ToolStepState.Running
            : ok
              ? ToolStepState.Done
              : ToolStepState.Failed
        addStep(
          { id: e.toolUseId, name: e.name, summary: e.summary, state, flagged: flagged.has(e.toolUseId), goalId: e.goalId, input: e.input, output: outputs.get(e.toolUseId) },
          `t${e.seq}`,
          false
        )
        break
      }
      case AgentEventType.RunDone:
        items.push({ kind: "done", key: `d${e.seq}`, ok: e.ok, turns: e.turns, durationMs: e.durationMs, costUsd: e.costUsd, ts: e.ts })
        break
      case AgentEventType.TurnChanges:
        items.push({ kind: "changes", key: `c${e.seq}`, files: e.files, skipped: e.skipped })
        break
      case AgentEventType.Error:
        items.push({ kind: "error", key: `e${e.seq}`, message: e.message })
        break
    }
  }

  if (live && running) {
    for (const t of live.tools) addStep({ id: t.id, name: t.name, summary: "", state: ToolStepState.Preparing }, `lt${t.id}`, true)
    if (live.text) items.push({ kind: "text", key: "live-text", text: live.text, live: true })
  }
  // The group the bot is currently working through stays open.
  const last = lastGroup()
  if (last && running) last.live = true
  return foldTurns(items, running)
}

/** Kept outside the fold: what you need to see without opening it. */
const VISIBLE = new Set<TranscriptItem["kind"]>(["user", "done", "error", "changes"])

/**
 * Fold each turn's work behind one "Worked for …" row. A turn runs from a user message to the next;
 * its final answer (the last text after the last tool call), errors, the done line and changed files
 * stay visible. Turns without tool calls are left as they are. The running turn folds too, open.
 */
export function foldTurns(items: TranscriptItem[], running: boolean): TranscriptItem[] {
  const out: TranscriptItem[] = []
  let i = 0
  while (i < items.length) {
    const start = items[i]!.kind === "user" ? i + 1 : i
    if (start > i) out.push(items[i]!)
    let end = start
    while (end < items.length && items[end]!.kind !== "user") end++
    const turn = items.slice(start, end)
    const isLast = end === items.length
    const live = running && isLast
    const opener = start > i ? (items[i] as Extract<TranscriptItem, { kind: "user" }>) : undefined
    const next = items[end] as Extract<TranscriptItem, { kind: "user" }> | undefined
    out.push(...foldTurn(turn, live, opener, next))
    i = end
  }
  return out
}

function foldTurn(
  turn: TranscriptItem[],
  live: boolean,
  opener: Extract<TranscriptItem, { kind: "user" }> | undefined,
  next: Extract<TranscriptItem, { kind: "user" }> | undefined
): TranscriptItem[] {
  const work = turn.filter((it) => !VISIBLE.has(it.kind))
  if (!work.some((it) => it.kind === "tools")) return turn
  // The final answer: text after the last tool group (none yet while the bot is still working).
  const lastTools = work.map((it) => it.kind).lastIndexOf("tools")
  const answer = live ? [] : work.slice(lastTools + 1)
  const folded = work.slice(0, live ? work.length : lastTools + 1)
  const done = turn.find((it): it is Extract<TranscriptItem, { kind: "done" }> => it.kind === "done")
  const startedAt = opener?.ts ?? 0
  const endedAt = live ? undefined : done ? (startedAt ? startedAt + done.durationMs : undefined) : next?.ts
  const activity: TranscriptItem = { kind: "activity", key: `a${opener?.key ?? folded[0]!.key}`, items: folded, startedAt, endedAt, live }
  const rest = turn.filter((it) => VISIBLE.has(it.kind))
  return [activity, ...answer, ...rest]
}

/** Show the bot avatar only on the first assistant row after a user message. */
export function startsAssistantBlock(items: TranscriptItem[], i: number) {
  const prev = items[i - 1]
  return !prev || prev.kind === "user"
}
