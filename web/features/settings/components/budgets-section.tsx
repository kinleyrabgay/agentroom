"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Segmented } from "@/components/kit/segmented"
import { usd } from "@/features/usage/lib/format"
import { useBudget } from "@/features/tasks/hooks/use-budget"
import { useSettingsSection } from "../hooks/use-settings-section"
import { SettingsSection } from "../lib/constants"
import { SaveIndicator } from "./save-indicator"
import { SettingsCard } from "./settings-card"

const WARN_OPTIONS = ["0.5", "0.7", "0.8", "0.9"] as const

/** Spend caps per goal and per day; goals pause at a cap instead of overspending. */
export function BudgetsSection() {
  const { value, update, status } = useSettingsSection("budgets")
  const summary = useBudget()
  return (
    <SettingsCard id={SettingsSection.Budgets} aside={<SaveIndicator status={status} />}>
      <div className="space-y-4">
        <CapRow
          id="budget-goal"
          label="Per goal"
          hint="A goal pauses when it has spent this much. Each goal can set its own from its header."
          value={value?.perGoalUsd ?? null}
          onChange={(perGoalUsd) => update({ perGoalUsd })}
        />
        <Separator />
        <CapRow
          id="budget-day"
          label="Per day"
          hint={`All bots together, reset at midnight. Spent today: ${usd(summary?.spentToday ?? 0)}.`}
          value={value?.perDayUsd ?? null}
          onChange={(perDayUsd) => update({ perDayUsd })}
        />
        <Separator />
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <p className="text-sm font-medium">Warn at</p>
            <p className="text-xs text-muted-foreground">You get one alert per goal and per day when spend crosses this line.</p>
          </div>
          <Segmented<(typeof WARN_OPTIONS)[number]>
            aria-label="Warn at"
            value={(WARN_OPTIONS.find((o) => Number(o) === value?.warnAt) ?? "0.8") as (typeof WARN_OPTIONS)[number]}
            onChange={(v) => update({ warnAt: Number(v) })}
            options={WARN_OPTIONS.map((o) => ({ value: o, label: `${Math.round(Number(o) * 100)}%` }))}
          />
        </div>
      </div>
    </SettingsCard>
  )
}

/** USD cap field: empty means no cap. Saves on blur or Enter. */
function CapRow({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: number | null; onChange: (v: number | null) => void }) {
  const [typed, setTyped] = useState<string | null>(null)
  const text = typed ?? (value === null ? "" : String(value))
  const parsed = text.trim() === "" ? null : Number(text)
  const valid = parsed === null || (Number.isFinite(parsed) && parsed > 0)
  const commit = () => {
    if (typed !== null && valid && parsed !== value) onChange(parsed)
    setTyped(null)
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-48 flex-1">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          id={id}
          inputMode="decimal"
          placeholder="No cap"
          value={text}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-invalid={!valid}
          className={cn("w-28 text-right tabular-nums")}
        />
      </div>
      {!valid && <p className="basis-full text-xs text-destructive">Enter an amount above $0, or leave it empty for no cap.</p>}
    </div>
  )
}
