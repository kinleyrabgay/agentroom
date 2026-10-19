"use client"

import { XIcon } from "lucide-react"
import type { Bot } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { unassignSkill } from "@/features/skills/lib/assign"

const MAX_VISIBLE = 3

type Chip = { name: string; own: boolean; description: string }

/** Skill chips on a bot card: up to three, then "+N". Click opens the bot's Skills tab. */
export function SkillChips({ bot }: { bot: Bot }) {
  const library = useAppStore((s) => s.skills)
  const select = useAppStore((s) => s.select)
  const openSkills = (e: React.MouseEvent) => {
    e.stopPropagation()
    select(bot.id, BotTab.Skills)
  }

  const chips: Chip[] = [
    ...bot.skills.map((name) => ({ name, own: false, description: library.find((s) => s.name === name)?.description ?? "" })),
    ...bot.localSkills.map((s) => ({ name: s.name, own: true, description: s.description })),
  ]
  const visible = chips.slice(0, MAX_VISIBLE)
  const hidden = chips.slice(MAX_VISIBLE)

  return (
    <div className="flex min-h-9 flex-wrap gap-1 rounded-b-xl border-t bg-sunken/70 px-3 py-2">
      {visible.map((c) => (
        <SkillChip key={`${c.own ? "own" : "lib"}:${c.name}`} bot={bot} chip={c} onOpen={openSkills} />
      ))}
      {hidden.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="cursor-pointer font-mono text-xs font-normal" onClick={openSkills}>
              +{hidden.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{hidden.map((c) => c.name).join(", ")}</TooltipContent>
        </Tooltip>
      )}
      {!chips.length && <span className="text-xs text-muted-foreground/70">No skills yet</span>}
    </div>
  )
}

function SkillChip({ bot, chip, onOpen }: { bot: Bot; chip: Chip; onOpen: (e: React.MouseEvent) => void }) {
  const recent = useAppStore((s) => s.recentSkill)
  // recentSkill is cleared by the store after the highlight period.
  const isNew = !chip.own && recent?.botId === bot.id && recent.skill === chip.name
  const glow = isNew

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          onClick={onOpen}
          className={cn(
            "group/chip cursor-pointer gap-0.5 font-mono text-xs font-normal transition-shadow",
            chip.own ? "gap-1 border-dashed border-[var(--bot)] bg-[color-mix(in_oklch,var(--bot)_8%,transparent)]" : "bg-surface",
            isNew && "animate-in duration-300 fade-in-0 zoom-in-50",
            glow && "ring-2 ring-brand"
          )}
        >
          {chip.name}
          {chip.own ? (
            <span className="font-sans text-xs text-muted-foreground">own</span>
          ) : (
            <button
              className="hidden text-muted-foreground group-hover/chip:inline group-focus-within/chip:inline hover:text-danger focus-visible:inline"
              aria-label={`Remove ${chip.name}`}
              onClick={(e) => {
                e.stopPropagation()
                unassignSkill(bot, chip.name)
              }}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <div className="font-mono text-xs">{chip.own ? `${chip.name} · ${bot.name}'s own` : chip.name}</div>
        {chip.description && <div className="mt-0.5 opacity-80">{chip.description}</div>}
      </TooltipContent>
    </Tooltip>
  )
}
