"use client"

import { useState } from "react"
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  Loader2Icon,
} from "lucide-react"
import { AgentEventType, ToolName, type EventOf, type Stamped } from "@shared"
import { cn } from "@/lib/utils"
import { Diff } from "@/components/shared/diff"
import { InjectionBadge } from "@/features/security/components/injection-badge"
import { hasInjectionFlag } from "@/features/security/lib/injection"

export type ToolCallEvent = Stamped<EventOf<typeof AgentEventType.ToolCall>>
export type ToolResultEvent = Stamped<EventOf<typeof AgentEventType.ToolResult>>

/** One tool call in the activity timeline; expands to its input (or a diff) and output. */
export function ToolRow({
  call,
  result,
}: {
  call: ToolCallEvent
  result?: ToolResultEvent
}) {
  const [open, setOpen] = useState(false)
  const Icon = !result ? Loader2Icon : result.ok ? CircleCheckIcon : CircleXIcon

  return (
    <li className="relative">
      <Icon
        className={cn(
          "absolute top-2 -left-[23px] size-3.5 bg-background",
          !result
            ? "animate-spin text-sky-500"
            : result.ok
              ? "text-emerald-500"
              : "text-destructive"
        )}
      />
      <div className="flex items-center gap-1 rounded-lg hover:bg-muted/60">
        <button
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left font-mono text-xs"
        >
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
          <span className="font-medium">{call.name}</span>
          <span className="truncate text-muted-foreground">{call.summary}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {new Date(call.ts).toLocaleTimeString()}
          </span>
        </button>
        {/* Sibling, not nested: the badge is its own button. */}
        {hasInjectionFlag(result?.output) && (
          <InjectionBadge goalId={call.goalId} />
        )}
      </div>
      {open && (
        <div className="mt-1 mb-2 space-y-2 pl-2">
          <ToolInput call={call} />
          {result && (
            <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/50 p-2.5 font-mono text-[11px] break-all whitespace-pre-wrap">
              {result.output || "(no output)"}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

function ToolInput({ call }: { call: ToolCallEvent }) {
  const input = (call.input ?? {}) as Record<string, unknown>
  if (
    (call.name === ToolName.Edit || call.name === ToolName.MultiEdit) &&
    typeof input.old_string === "string"
  ) {
    return (
      <Diff
        path={call.summary}
        before={input.old_string}
        after={String(input.new_string ?? "")}
      />
    )
  }
  if (call.name === ToolName.Write && typeof input.content === "string") {
    return <Diff path={call.summary} before="" after={input.content} />
  }
  return (
    <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/30 p-2.5 font-mono text-[11px] break-all whitespace-pre-wrap text-muted-foreground">
      {JSON.stringify(input, null, 2)}
    </pre>
  )
}
