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
        "relative w-64 cursor-pointer overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md",
        selected && "ring-2 ring-[var(--bot)]",
        active && "shadow-[0_0_0_4px_color-mix(in_oklch,var(--bot)_18%,transparent)]",
        target && !over && "-translate-y-1 border-dashed border-[var(--bot)] shadow-lg ring-2 ring-[color-mix(in_oklch,var(--bot)_35%,transparent)]",
        target && over && "-translate-y-1 scale-[1.04] border-[var(--bot)] shadow-xl ring-4 ring-[var(--bot)]",
        hasDragged && "opacity-60"
      )}
    >
      {dragging && <DropHint skill={dragging} accepts={target} over={over} />}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center gap-3 p-3 pb-2">
        <BotAvatar bot={bot} className="size-10 rounded-xl text-xl" />
        <div className="min-w-0 flex-1">
          <div className="truncate leading-tight font-medium">{bot.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", meta.dot, active && "animate-pulse")} />
            {meta.label}
            <span className="opacity-50">·</span>
            <span className="truncate">{bot.role}</span>
          </div>
          <div className="truncate text-[10px] text-muted-foreground/70">{modelLabel}</div>
        </div>
      </div>

      {!bot.reportsTo && <GoalChip />}

      {preview && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            select(bot.id, BotTab.Browser)
          }}
          className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1.5 text-left font-mono text-[10px] text-muted-foreground hover:bg-muted"
          title="Open live browser"
        >
          <GlobeIcon className="size-3 shrink-0 text-sky-500" />
          <span className="truncate">{stripScheme(previewUrl(preview))}</span>
        </button>
      )}

      <div className="mx-3 mb-2 h-4 truncate font-mono text-[11px] text-muted-foreground" title={st.activity}>
        {active ? (st.activity ?? "") : ""}
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
          "animate-in rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm duration-150 fade-in-0 zoom-in-95",
          accepts ? "bg-[var(--bot)] text-white" : "bg-muted text-muted-foreground",
          accepts && over && "scale-105"
        )}
      >
        {accepts ? `Drop to add ${skill}` : `Already has ${skill}`}
      </span>
    </div>
  )
}
