"use client"

import { useState } from "react"
import { ChevronDownIcon, LockIcon, ShieldAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PermissionRequest } from "@/lib/store/selectors"
import { Button } from "@/components/ui/button"
import { answerPermission } from "@/features/approvals/lib/actions"
import { describeRequest } from "@/features/approvals/lib/describe"
import { gateFindings } from "@/features/approvals/components/security-gate-card"

const SUMMARY_CHARS = 240

/** One line per request: the tool and what it will do (first line, backticks stripped). */
function lineOf(p: PermissionRequest) {
  const view = describeRequest(p.tool, (p.input ?? {}) as Record<string, unknown>, p.summary)
  const text = (p.summary || view.preview).split("\n").find((l) => l.trim())?.replace(/`/g, "").trim() ?? ""
  return { label: view.label, text: text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS)}…` : text }
}

/**
 * Slim bar above the composer so a waiting approval is always in reach, even scrolled away from its
 * card. Several fold into "N approvals needed" with Approve all / Deny all. Security-gated requests
 * (commit/push/PR with open findings) are left out of "Approve all": those need their card.
 */
export function ApprovalBar({ approvals }: { approvals: PermissionRequest[] }) {
  const [open, setOpen] = useState(false)
  if (!approvals.length) return null
  const routine = approvals.filter((p) => !gateFindings(p).length)
  const first = lineOf(approvals[0]!)

  if (approvals.length === 1) {
    const p = approvals[0]!
    const gated = gateFindings(p).length > 0
    return (
      <div className="tone-warning tone-bar mx-3 mb-2 flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs" role="status" aria-label="Approval needed">
        {gated ? <ShieldAlertIcon className="tone-text size-3.5 shrink-0" /> : <LockIcon className="tone-text size-3.5 shrink-0" />}
        <code className="shrink-0 rounded border bg-surface px-1 font-mono">{first.label}</code>
        <span className="min-w-0 flex-1 truncate" title={first.text}>{gated ? "Security check: review the card above" : first.text}</span>
        <Button size="xs" variant="ghost" className="tone-danger tone-text" onClick={() => answerPermission(p.requestId, false)}>
          Deny
        </Button>
        {!gated && (
          <Button size="xs" onClick={() => answerPermission(p.requestId, true)}>
            Approve
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="tone-warning tone-bar mx-3 mb-2 overflow-hidden rounded-xl border text-xs" role="status" aria-label={`${approvals.length} approvals needed`}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <LockIcon className="tone-text size-3.5 shrink-0" />
        <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="shrink-0 font-medium">{approvals.length} approvals needed</span>
          <span className="truncate text-muted-foreground">
            {first.label}: {first.text} and {approvals.length - 1} more
          </span>
          <ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        <Button size="xs" variant="ghost" className="tone-danger tone-text" onClick={() => approvals.forEach((p) => answerPermission(p.requestId, false))}>
          Deny all
        </Button>
        <Button size="xs" disabled={!routine.length} onClick={() => routine.forEach((p) => answerPermission(p.requestId, true))} title={routine.length < approvals.length ? "Security checks are left for their cards" : undefined}>
          Approve all{routine.length < approvals.length ? ` ${routine.length}` : ""}
        </Button>
      </div>
      {open && (
        <ul className="border-t bg-surface/60">
          {approvals.map((p) => {
            const l = lineOf(p)
            const gated = gateFindings(p).length > 0
            return (
              <li key={p.requestId} className="flex items-center gap-2 border-b px-3 py-1 last:border-b-0">
                <code className="shrink-0 rounded border bg-surface px-1 font-mono">{l.label}</code>
                <span className="min-w-0 flex-1 truncate" title={l.text}>{gated ? "Security check: review its card" : l.text}</span>
                <Button size="xs" variant="ghost" className="tone-danger tone-text" onClick={() => answerPermission(p.requestId, false)}>
                  Deny
                </Button>
                {!gated && (
                  <Button size="xs" variant="outline" onClick={() => answerPermission(p.requestId, true)}>
                    Approve
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
