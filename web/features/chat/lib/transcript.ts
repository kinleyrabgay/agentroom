import { AgentEventType, type StampedEvent } from "@shared"
import type { LiveReply } from "@/lib/store/live-reply"

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
}

export type TranscriptItem =
  | { kind: "user"; key: string; text: string; from: string }
  | { kind: "text"; key: string; text: string; live?: boolean }
  | { kind: "tools"; key: string; steps: ToolStep[]; live: boolean }
  | { kind: "done"; key: string; ok: boolean; turns: number; durationMs: number; costUsd: number }
  | { kind: "error"; key: string; message: string }

export const isActiveStep = (s: ToolStep) =>
  s.state === ToolStepState.Running || s.state === ToolStepState.Preparing || s.state === ToolStepState.Waiting

/**
 * Fold a bot's events (plus its live stream) into chat items. Consecutive tool calls
 * collapse into one group, like Claude's "Used N tools".
 */
export function buildTranscript(evs: StampedEvent[], live: LiveReply | undefined, running: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const results = new Map<string, boolean>()
  for (const e of evs) if (e.type === AgentEventType.ToolResult) results.set(e.toolUseId, e.ok)

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
        items.push({ kind: "user", key: `u${e.seq}`, text: e.text, from: e.from })
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
        addStep({ id: e.toolUseId, name: e.name, summary: e.summary, state }, `t${e.seq}`, false)
        break
      }
      case AgentEventType.RunDone:
        items.push({ kind: "done", key: `d${e.seq}`, ok: e.ok, turns: e.turns, durationMs: e.durationMs, costUsd: e.costUsd })
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
  return items
}

/** Show the bot avatar only on the first assistant row after a user message. */
export function startsAssistantBlock(items: TranscriptItem[], i: number) {
  const prev = items[i - 1]
  return !prev || prev.kind === "user"
}
