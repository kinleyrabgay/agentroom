"use client"

import { memo, useState } from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { GlobeIcon } from "lucide-react"
import { BotStatus, type Bot } from "@shared"
import { cn } from "@/lib/utils"
import { BotTab, DragType, isBusy, STATUS_META } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { previewUrl, stripScheme } from "@/lib/store/selectors"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { ToneDot } from "@/components/kit/badge"
import { useBotModelLabel } from "@/features/models/components/model-label"
import { assignSkill } from "@/features/skills/lib/assign"
import { endSkillDrag } from "@/features/skills/lib/drag"
import { GoalChip } from "./goal-chip"
import { SkillChips } from "./skill-chips"

export type BotNodeData = { bot: Bot }

/** A bot card on the team canvas. Accepts dropped library skills. */
export const BotNode = memo(function BotNode({ data }: NodeProps<Node<BotNodeData>>) {
  const { bot } = data
  const st = useAppStore((s) => s.statuses[bot.id]) ?? { status: BotStatus.Idle }
  const selected = useAppStore((s) => s.selectedBot === bot.id)
  const preview = useAppStore((s) => s.previews[bot.id])
  const select = useAppStore((s) => s.select)
  const dragging = useAppStore((s) => s.draggingSkill)
  const [over, setOver] = useState(false)
  const modelLabel = useBotModelLabel(bot)
  const meta = STATUS_META[st.status]
  const active = isBusy(st.status)
  // While a skill is dragged, every bot shows whether it can take it.
  const hasDragged = !!dragging && (bot.skills.includes(dragging) || bot.localSkills.some((s) => s.name === dragging))
  const target = !!dragging && !hasDragged

  const waiting = st.status === BotStatus.Waiting
  const failed = st.status === BotStatus.Error

  return (
    <div
      onClick={() => select(bot.id)}
      onDragOver={(e) => {
        if (!target || !e.dataTransfer.types.includes(DragType.Skill)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const skill = e.dataTransfer.getData(DragType.Skill)
        endSkillDrag()
        if (skill && target) assignSkill(bot, skill)
      }}
      style={{ ["--bot" as string]: bot.color }}
      className={cn(
        "relative w-64 cursor-pointer rounded-xl border bg-card text-card-foreground shadow-xs transition-[box-shadow,transform,opacity] duration-200 hover:shadow-md",
        selected && "ring-2 ring-brand ring-offset-2 ring-offset-background",
        waiting && !selected && "tone-warning ring-2 ring-[var(--tone)]",
        failed && !selected && "tone-danger ring-2 ring-[var(--tone)]",
        target && !over && "-translate-y-1 border-dashed border-brand shadow-lg",
        target && over && "-translate-y-1 scale-[1.03] border-brand shadow-xl ring-2 ring-brand",
        hasDragged && "opacity-60"
      )}
    >
      {/* Working: a slow breathing outline in the brand colour. */}
      {active && !waiting && (
        <span aria-hidden className="pointer-events-none absolute -inset-px animate-pulse rounded-xl border border-brand/60 [animation-duration:2.4s]" />
      )}
      {dragging && <DropHint skill={dragging} accepts={target} over={over} />}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-start gap-3 p-3 pb-2">
        <BotAvatar bot={bot} className="size-10 rounded-lg text-xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate leading-tight font-semibold tracking-tight">{bot.name}</span>
            <ToneDot tone={meta.tone} pulse={active} />
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {meta.label} · {bot.role}
          </div>
          <div className="truncate text-xs text-muted-foreground/80">{modelLabel}</div>
        </div>
      </div>

      {!bot.reportsTo && <GoalChip />}

      {preview && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            select(bot.id, BotTab.Browser)
          }}
          aria-label="Open live browser"
          className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-lg border bg-sunken px-2 py-1.5 text-left font-mono text-xs text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <GlobeIcon className="size-3.5 shrink-0 text-info" />
          <span className="truncate">{stripScheme(previewUrl(preview))}</span>
        </button>
      )}

      <div
        className={cn("mx-3 mb-2 h-4 truncate font-mono text-xs", active ? "text-foreground/80" : "text-muted-foreground/60")}
        title={st.activity}
      >
        {active ? (st.activity ?? "Working…") : "Idle"}
      </div>

      <SkillChips bot={bot} />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
})

/** Overlay pill shown on every bot while a skill is being dragged. */
function DropHint({ skill, accepts, over }: { skill: string; accepts: boolean; over: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <span
        className={cn(
          "animate-in rounded-full px-2.5 py-1 text-xs font-medium shadow-sm duration-150 fade-in-0 zoom-in-95",
          accepts ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
          accepts && over && "scale-105"
        )}
      >
        {accepts ? `Drop to add ${skill}` : `Already has ${skill}`}
      </span>
    </div>
  )
}
