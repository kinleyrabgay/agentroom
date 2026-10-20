"use client"

import { memo } from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import type { ContextModuleSummary } from "@shared"
import { cn } from "@/lib/utils"
import { ToneDot } from "@/components/kit/badge"
import { CARD_STATUS, moduleName } from "../lib/meta"
import { NODE_HEIGHT, nodeWidth } from "../lib/layout"

export type ModuleNodeData = {
  module: ContextModuleSummary
  /** Selected in the Inspector. */
  active: boolean
  /** Another module is hovered and this one isn't connected to it. */
  dim: boolean
  /** In the blast radius (impact mode): changed or depending on the change. */
  impact: "changed" | "affected" | null
}

/** One module on the context map: name, folder, size and whether its card is current. */
export const ModuleNode = memo(function ModuleNode({ data }: NodeProps<Node<ModuleNodeData>>) {
  const { module: m, active, dim, impact } = data
  const status = CARD_STATUS[m.status]
  return (
    <div
      style={{ width: nodeWidth(m.files), height: NODE_HEIGHT }}
      className={cn(
        "group flex cursor-pointer flex-col justify-center gap-1 rounded-xl border bg-surface px-3 shadow-xs transition-[opacity,box-shadow,border-color] duration-150",
        "hover:border-ring/60 hover:shadow-sm",
        active && "border-brand ring-2 ring-brand/30",
        impact === "changed" && "tone-danger border-[var(--tone)] ring-2 ring-[var(--tone)]/25",
        impact === "affected" && "tone-warning border-[var(--tone)]",
        dim && "opacity-30"
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
      <div className="flex min-w-0 items-center gap-2">
        <span title={`${status.label}: ${status.hint}`} className="inline-flex">
          <ToneDot tone={status.tone} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{moduleName(m)}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={`${m.files} files${m.tests ? `, ${m.tests} tests` : ""}`}>
          {m.files}
        </span>
      </div>
      <span className="truncate pl-4 font-mono text-[11px] text-muted-foreground">{m.dir ? `${m.dir}/` : "./"}</span>
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
    </div>
  )
})

export type AreaNodeData = { label: string; count: number }

/** A top-level folder's frame behind its modules. */
export const AreaNode = memo(function AreaNode({ data, width, height }: NodeProps<Node<AreaNodeData>>) {
  return (
    <div style={{ width, height }} className="pointer-events-none rounded-3xl border border-dashed bg-sunken/40">
      <div className="flex items-baseline gap-2 px-6 pt-4">
        <span className="font-mono text-sm font-medium">{data.label}</span>
        <span className="text-xs text-muted-foreground">{data.count} modules</span>
      </div>
    </div>
  )
})
