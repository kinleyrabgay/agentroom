"use client"

import { useState } from "react"
import { ArrowUpRightIcon } from "lucide-react"
import { FindingSeverity, type SecurityFinding } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import type { PermissionRequest } from "@/lib/store/selectors"
import { Button } from "@/components/ui/button"
import { ToneBadge } from "@/components/kit/badge"
import { TONE_CLASS } from "@/components/kit/tone"
import { answerPermission } from "../lib/actions"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { SEVERITY_META } from "@/features/security/constants"
import { bySeverityThenNewest, gateAction, location } from "@/features/security/lib/findings"

/** Findings attached by the server to a permission request (security gate before commit/push/PR). */
export function gateFindings(p: PermissionRequest): SecurityFinding[] {
  const f = (p as PermissionRequest & { findings?: unknown }).findings
  return Array.isArray(f) ? (f as SecurityFinding[]) : []
}

/** A blocked commit/push/PR: what the scanner found, and an explicit, acknowledged override. No "Always allow". */
export function SecurityGateCard({ request: p, findings, className }: { request: PermissionRequest; findings: SecurityFinding[]; className?: string }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === p.botId))
  const showSecurity = useAppStore((s) => s.showSecurity)
  const [reviewed, setReviewed] = useState(false)
  const command = String((p.input as Record<string, unknown> | undefined)?.command ?? p.summary)
  const critical = findings.some((f) => f.severity === FindingSeverity.Critical)
  const sorted = [...findings].sort(bySeverityThenNewest)
  const goalId = p.goalId ?? findings.find((f) => f.goalId)?.goalId
  const head = SEVERITY_META[critical ? FindingSeverity.Critical : FindingSeverity.Warning]
  const HeadIcon = head.icon

  return (
    <article className={cn("overflow-hidden rounded-xl border bg-card", className)} aria-label={`Security check before ${gateAction(command)}`}>
      <header className={cn(TONE_CLASS[head.tone], "tone-soft flex flex-wrap items-center gap-2 border-0 border-b px-4 py-3")}>
        <HeadIcon className="size-4" aria-hidden />
        <span className="font-medium">Security check before {gateAction(command)}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-foreground/70">
          {bot && <BotAvatar bot={bot} className="size-4 rounded text-[9px]" />}
          {bot?.name ?? p.botId} · {findings.length} {findings.length === 1 ? "finding" : "findings"}
        </span>
      </header>
      <div className="space-y-2.5 px-4 py-3">
        <pre className="overflow-x-auto rounded-lg border bg-sunken px-3 py-2 font-mono text-xs">$ {command}</pre>
        <ul className="max-h-56 space-y-1.5 overflow-y-auto">
          {sorted.map((f) => {
            const meta = SEVERITY_META[f.severity]
            const where = location(f)
            return (
              <li key={f.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-start gap-2 text-sm">
                  <ToneBadge tone={meta.tone} icon={meta.icon} size="sm">
                    {meta.label}
                  </ToneBadge>
                  <span className="min-w-0 font-medium">{f.title}</span>
                </div>
                {where && <code className="mt-1 block truncate font-mono text-xs text-muted-foreground">{where}</code>}
                {f.snippet && <code className="block truncate font-mono text-xs text-muted-foreground/80">{f.snippet}</code>}
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-2 pt-0.5">
          <Checkbox id={`reviewed-${p.requestId}`} checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />
          <Label htmlFor={`reviewed-${p.requestId}`} className="text-sm font-normal">
            I reviewed these findings
          </Label>
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t bg-sunken/50 px-4 py-2.5">
        <Button size="sm" variant={critical ? "destructive" : "default"} disabled={!reviewed} onClick={() => answerPermission(p.requestId, true)}>
          Approve anyway
        </Button>
        <Button size="sm" variant="outline" onClick={() => answerPermission(p.requestId, false)} aria-label="Deny; the bot fixes the findings and tries again">
          Deny · let the bot fix it
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => showSecurity(goalId)}>
          Open in Security <ArrowUpRightIcon data-icon="inline-end" />
        </Button>
      </footer>
    </article>
  )
}
