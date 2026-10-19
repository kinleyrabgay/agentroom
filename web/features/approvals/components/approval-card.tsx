"use client"

import { ShieldAlertIcon } from "lucide-react"
import { ToolName } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import type { PermissionRequest } from "@/lib/store/selectors"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Diff } from "@/components/shared/diff"
import { describeRequest } from "../lib/describe"
import { answerPermission } from "../lib/actions"
import { gateFindings, SecurityGateCard } from "./security-gate-card"

/** Server marks dangerous commands with this reason; they can't be session-allowed. */
const STICKY_MARKER = "always requires"
const WRITE_PREVIEW_LIMIT = 3000

/** A bot is waiting for your OK. `shortcuts` shows the A / D hints (the Inbox handles the keys). */
export function ApprovalCard({ request: p, shortcuts, className }: { request: PermissionRequest; shortcuts?: boolean; className?: string }) {
  const findings = gateFindings(p)
  if (findings.length) return <SecurityGateCard request={p} findings={findings} className={className} />
  return <ToolApprovalCard request={p} shortcuts={shortcuts} className={className} />
}

function ToolApprovalCard({ request: p, shortcuts, className }: { request: PermissionRequest; shortcuts?: boolean; className?: string }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === p.botId))
  const select = useAppStore((s) => s.select)
  const input = (p.input ?? {}) as Record<string, unknown>
  const view = describeRequest(p.tool, input, p.summary)
  const sticky = p.reason.includes(STICKY_MARKER)

  return (
    <article className={cn("overflow-hidden rounded-xl border bg-card", className)} aria-label={`${bot?.name ?? p.botId} wants to use ${view.label}`}>
      <header className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-2.5">
        {bot && <BotAvatar bot={bot} className="size-6 rounded-md text-xs" />}
        <button className="rounded font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60" onClick={() => select(p.botId, view.isBrowser ? BotTab.Browser : BotTab.Chat)}>
          {bot?.name ?? p.botId}
        </button>
        <span className="text-sm text-muted-foreground">wants to use</span>
        <code className="rounded-md border bg-sunken px-1.5 py-0.5 font-mono text-xs">{view.label}</code>
        <span className="tone-warning tone-text ml-auto inline-flex items-center gap-1 text-xs font-medium">
          <ShieldAlertIcon className="size-3.5" /> {p.reason}
        </span>
      </header>
      <div className="px-4 pb-3">
        {p.tool === ToolName.Edit && typeof input.old_string === "string" ? (
          <Diff path={p.summary} before={input.old_string} after={String(input.new_string ?? "")} />
        ) : p.tool === ToolName.Write && typeof input.content === "string" ? (
          <Diff path={p.summary} before="" after={input.content.slice(0, WRITE_PREVIEW_LIMIT)} />
        ) : (
          <pre className="max-h-44 overflow-auto rounded-lg border bg-sunken p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{view.preview}</pre>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t bg-sunken/50 px-4 py-2.5">
        <Button size="sm" onClick={() => answerPermission(p.requestId, true)}>
          Approve {shortcuts && <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">A</Kbd>}
        </Button>
        {!sticky && (
          <Button size="sm" variant="outline" onClick={() => answerPermission(p.requestId, true, true)} aria-describedby={`always-${p.requestId}`}>
            Always allow {view.group}
          </Button>
        )}
        <span id={`always-${p.requestId}`} className="sr-only">
          Allows every {view.group} action until the server restarts
        </span>
        <Button size="sm" variant="ghost" className="tone-danger tone-text ml-auto" onClick={() => answerPermission(p.requestId, false)}>
          Deny {shortcuts && <Kbd className="ml-1">D</Kbd>}
        </Button>
      </footer>
    </article>
  )
}
