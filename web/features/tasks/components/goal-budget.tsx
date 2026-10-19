"use client"

import { useState } from "react"
import { WalletIcon } from "lucide-react"
import { toast } from "sonner"
import type { Goal } from "@shared"
import { cn } from "@/lib/utils"
import { goalApi } from "@/lib/api/endpoints"
import { usd } from "@/features/usage/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TONE_CLASS } from "@/components/kit/tone"
import { budgetTone, useBudget } from "../hooks/use-budget"

/** "$4.10 of $5.00" with a thin meter; click to set this goal's own budget. */
export function GoalBudget({ goal }: { goal: Goal }) {
  const budget = useBudget()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  if (!budget) return null
  const row = budget.goals[goal.id] ?? { spent: 0, cap: goal.budgetUsd ?? budget.perGoalUsd }
  const tone = budgetTone(row.spent, row.cap, budget.warnAt)
  const pct = row.cap ? Math.min(100, (row.spent / row.cap) * 100) : 0

  const save = async (value: number | null) => {
    try {
      await goalApi.update(goal.id, { budgetUsd: value })
      setOpen(false)
      toast.success(value === null ? "Using the team default budget" : `Budget set to ${usd(value)}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) setDraft(goal.budgetUsd ? String(goal.budgetUsd) : "")
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-full px-2 py-1 text-xs text-muted-foreground tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label="Goal budget"
        >
          <WalletIcon className="size-3.5" />
          {row.cap ? (
            <>
              <span className={cn(tone !== "neutral" && cn(TONE_CLASS[tone], "tone-text font-medium"))}>
                {usd(row.spent)} of {usd(row.cap)}
              </span>
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className={cn("block h-full rounded-full", tone === "neutral" ? "bg-brand" : cn(TONE_CLASS[tone], "tone-solid"))} style={{ width: `${pct}%` }} />
              </span>
            </>
          ) : (
            <span>{usd(row.spent)} · no budget</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Budget for {goal.id}</p>
          <p className="text-xs text-muted-foreground">
            The goal pauses when it has spent this much. {budget.perGoalUsd ? `Team default: ${usd(budget.perGoalUsd)}.` : "No team default is set."}
          </p>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(draft)
            if (!(n > 0)) return toast.error("Enter an amount above $0.")
            void save(n)
          }}
        >
          <div className="flex-1 space-y-1">
            <Label htmlFor={`budget-${goal.id}`} className="text-xs">USD</Label>
            <Input id={`budget-${goal.id}`} inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={budget.perGoalUsd ? String(budget.perGoalUsd) : "5.00"} />
          </div>
          <Button type="submit" size="sm">Save</Button>
        </form>
        {goal.budgetUsd !== undefined && (
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => void save(null)}>
            Use the team default
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
