"use client"

import { useState } from "react"
import { ArrowUpRightIcon } from "lucide-react"
import { ClientMessageType, FindingSeverity, type SecurityFinding } from "@shared"
import { cn } from "@/lib/utils"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import type { PermissionRequest } from "@/lib/store/selectors"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
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
export function SecurityGateCard({ request: p, findings }: { request: PermissionRequest; findings: SecurityFinding[] }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === p.botId))
  const showSecurity = useAppStore((s) => s.showSecurity)
  const [reviewed, setReviewed] = useState(false)
  const command = String((p.input as Record<string, unknown> | undefined)?.command ?? p.summary)
  const critical = findings.some((f) => f.severity === FindingSeverity.Critical)
  const sorted = [...findings].sort(bySeverityThenNewest)
  const answer = (allow: boolean) => send({ type: ClientMessageType.Permission, requestId: p.requestId, allow })
  const goalId = p.goalId ?? findings.find((f) => f.goalId)?.goalId

  return (
    <Card className={cn("pointer-events-auto gap-3 overflow-hidden py-0 shadow-xl", critical ? "border-red-500/50" : "border-amber-500/50")}>
      <CardHeader className={cn("gap-1 px-4 py-3", critical ? "bg-red-500/10" : "bg-amber-500/10")}>
        <CardTitle className={cn("flex items-center gap-2 text-sm", critical ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300")}>
          {(() => {
            const Icon = SEVERITY_META[critical ? FindingSeverity.Critical : FindingSeverity.Warning].icon
            return <Icon className="size-4" />
          })()}
          Security check before {gateAction(command)}
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5 text-xs">
          {bot && <BotAvatar bot={bot} className="size-4 rounded text-[9px]" />}
          {bot?.name ?? p.botId} · {findings.length} {findings.length === 1 ? "finding" : "findings"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-4">
        <pre className="overflow-x-auto rounded-lg border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">$ {command}</pre>
        <ul className="max-h-56 space-y-1.5 overflow-y-auto">
          {sorted.map((f) => {
            const meta = SEVERITY_META[f.severity]
            const Icon = meta.icon
            const where = location(f)
            return (
              <li key={f.id} className="rounded-lg border px-2.5 py-1.5">
                <div className="flex items-start gap-1.5 text-xs">
                  <Icon className={cn("mt-0.5 size-3.5 shrink-0", meta.text)} aria-label={meta.label} />
                  <span className="font-medium">{f.title}</span>
                </div>
                {where && <code className="block truncate pl-5 font-mono text-[11px] text-muted-foreground">{where}</code>}
                {f.snippet && <code className="block truncate pl-5 font-mono text-[11px] text-muted-foreground/80">{f.snippet}</code>}
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-2 pt-1">
          <Checkbox id={`reviewed-${p.requestId}`} checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />
          <Label htmlFor={`reviewed-${p.requestId}`} className="text-xs font-normal">
            I reviewed these findings
          </Label>
        </div>
      </CardContent>
      <CardFooter className="gap-2 px-4 pb-3">
        <Button size="sm" variant={critical ? "destructive" : "default"} disabled={!reviewed} onClick={() => answer(true)}>
          Approve anyway
        </Button>
        <Button size="sm" variant="outline" onClick={() => answer(false)} title="Deny; the bot fixes the findings and tries again">
          Deny · let the bot fix it
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => showSecurity(goalId)}>
          Open in Security <ArrowUpRightIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  )
}
