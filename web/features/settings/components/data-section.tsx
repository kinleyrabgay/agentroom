"use client"

import { useState } from "react"
import { GitCommitHorizontalIcon, HardDriveIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useSettingsSection } from "../hooks/use-settings-section"
import { DATA_FILES, RETENTION_LIMITS, SettingsSection } from "../lib/constants"
import { SaveIndicator } from "./save-indicator"
import { SettingsCard } from "./settings-card"

/** Audit retention + what's committed vs kept locally. */
export function DataSection() {
  const { value, update, status } = useSettingsSection("audit")
  // While typing, keep the raw text; otherwise show the saved value.
  const [typed, setTyped] = useState<string | null>(null)
  const days = typed ?? String(value?.retentionDays ?? "")
  const parsed = Number(days)
  const valid = Number.isInteger(parsed) && parsed >= RETENTION_LIMITS.min && parsed <= RETENTION_LIMITS.max

  const commit = () => {
    if (typed !== null && valid && parsed !== value?.retentionDays) update({ retentionDays: parsed })
    setTyped(null)
  }

  return (
    <SettingsCard id={SettingsSection.Data} aside={<SaveIndicator status={status} />}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor="audit-retention" className="text-sm font-medium">
            Keep audit log for
          </Label>
          <p className="text-xs text-muted-foreground">Older entries are pruned when AgentRoom starts.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="audit-retention"
            type="number"
            inputMode="numeric"
            min={RETENTION_LIMITS.min}
            max={RETENTION_LIMITS.max}
            value={days}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-invalid={!valid}
            className={cn("w-24 text-right tabular-nums")}
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
      </div>
      {!valid && typed !== null && (
        <p className="mt-1 text-xs text-destructive">
          Enter a whole number from {RETENTION_LIMITS.min} to {RETENTION_LIMITS.max}.
        </p>
      )}

      <Separator className="my-4" />
      <h3 className="mb-2 text-sm font-medium">Where AgentRoom keeps things</h3>
      <ul className="divide-y rounded-xl border text-sm">
        {DATA_FILES.map((f) => (
          <li key={f.path} className="flex items-start gap-3 px-3 py-2.5">
            {f.committed ? (
              <GitCommitHorizontalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : (
              <HardDriveIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <code className="font-mono text-xs break-all">{f.path}</code>
              <p className="text-xs text-muted-foreground">{f.what}</p>
            </div>
            <Badge variant={f.committed ? "secondary" : "outline"} className="shrink-0 font-normal">
              {f.committed ? "Committed" : "Local only"}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Everything under <code className="font-mono">.agentroom/runs/</code> is gitignored.
      </p>
    </SettingsCard>
  )
}
