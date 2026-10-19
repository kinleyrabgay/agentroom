"use client"

import { useState } from "react"
import { totalTokens, type TokenCounts } from "@shared"
import { cn } from "@/lib/utils"
import { TOKEN_KINDS } from "../constants"
import { compact, pct } from "../lib/format"

/** Stacked bar of token kinds (2px surface gaps) with a labelled legend; hovering links bar and legend. */
export function TokenMix({ counts }: { counts: TokenCounts }) {
  const total = totalTokens(counts)
  const [hover, setHover] = useState<string | null>(null)
  const parts = TOKEN_KINDS.map((k) => ({ ...k, value: counts[k.key] })).filter((p) => p.value > 0)

  return (
    <div>
      <div className="flex h-3 gap-[2px]" onMouseLeave={() => setHover(null)}>
        {parts.map((p, i) => (
          <div
            key={p.key}
            onMouseEnter={() => setHover(p.key)}
            className={cn(
              "h-full min-w-[3px] transition-opacity",
              i === 0 && "rounded-l-[4px]",
              i === parts.length - 1 && "rounded-r-[4px]",
              hover && hover !== p.key && "opacity-40"
            )}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {TOKEN_KINDS.map((k) => {
          const v = counts[k.key]
          return (
            <li
              key={k.key}
              onMouseEnter={() => setHover(k.key)}
              onMouseLeave={() => setHover(null)}
              className={cn("flex items-center gap-2 rounded-md transition-opacity", hover && hover !== k.key && "opacity-50")}
            >
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: k.color }} />
              <span className="flex-1 text-muted-foreground">{k.label}</span>
              <span className="font-medium tabular-nums">{compact(v)}</span>
              <span className="w-8 text-right text-[10px] text-muted-foreground tabular-nums">{total ? pct(v / total) : "—"}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
