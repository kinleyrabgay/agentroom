"use client"

import type { RiskAssessment } from "@shared"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TONE_CLASS } from "@/components/kit/tone"
import { RISK_META } from "../constants"

/** Risk level + score; click (or Enter) lists what contributed and the diff size. */
export function RiskBadge({ risk }: { risk: RiskAssessment }) {
  const meta = RISK_META[risk.level]
  const Icon = meta.icon
  const factors = [...risk.factors].sort((a, b) => b.points - a.points)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            TONE_CLASS[meta.tone],
            "tone-soft inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          )}
          aria-label={`${meta.label}, score ${risk.score}. Show details`}
        >
          <Icon className="size-3.5" /> {meta.label} · {risk.score}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-3 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="font-medium">{meta.label}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{risk.score}/100</span>
        </div>
        <p className="text-xs text-muted-foreground">{meta.hint}</p>
        {factors.length > 0 && (
          <ul className="space-y-1 border-t pt-2">
            {factors.map((f) => (
              <li key={f.label} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-foreground/90">{f.label}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">+{f.points}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t pt-2 font-mono text-xs text-muted-foreground">
          {risk.files} {risk.files === 1 ? "file" : "files"} · +{risk.additions} −{risk.deletions}
        </p>
      </PopoverContent>
    </Popover>
  )
}
