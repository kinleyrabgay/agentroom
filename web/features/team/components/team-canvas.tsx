"use client"

import "@xyflow/react/dist/style.css"
import { useMemo, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react"
import { PlusIcon } from "lucide-react"
import { AgentEventType, BotStatus, type Bot, type StampedEvent } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { treeLayout } from "../lib/tree-layout"
import { AutoFit } from "./auto-fit"
import { BotNode, type BotNodeData } from "./bot-node"
import { NewBotDialog } from "./new-bot-dialog"

const nodeTypes = { bot: BotNode }

/** Delegation edges stay animated until the receiving bot finishes. */
function activeDelegations(events: StampedEvent[]) {
  const live = new Set<string>()
  for (const e of events) {
    if (e.type === AgentEventType.Delegation) live.add(`${e.from}->${e.to}`)
    const finished = e.type === AgentEventType.RunDone || (e.type === AgentEventType.BotStatus && e.status === BotStatus.Idle)
    if (finished) for (const k of [...live]) if (k.endsWith(`->${e.botId}`)) live.delete(k)
  }
  return live
}

function buildGraph(bots: Bot[], live: Set<string>) {
  const pos = treeLayout(bots)
  const ids = new Set(bots.map((b) => b.id))
  const nodes: Node<BotNodeData>[] = bots.map((b) => ({ id: b.id, type: "bot", position: pos[b.id], data: { bot: b } }))
  const edges: Edge[] = bots
    .filter((b) => b.reportsTo && ids.has(b.reportsTo))
    .map((b) => {
      const animated = live.has(`${b.reportsTo}->${b.id}`)
      return {
        id: `${b.reportsTo}->${b.id}`,
        source: b.reportsTo!,
        target: b.id,
        type: "smoothstep",
        animated,
        style: { stroke: animated ? b.color : "var(--border)", strokeWidth: animated ? 2.5 : 1.5 },
      }
    })
  return { nodes, edges }
}

export function TeamCanvas() {
  const bots = useAppStore((s) => s.bots)
  const events = useAppStore((s) => s.events)
  const { resolvedTheme } = useTheme()
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useAppStore((s) => !!s.draggingSkill)

  const live = useMemo(() => activeDelegations(events), [events])
  const { nodes, edges } = useMemo(() => buildGraph(bots, live), [bots, live])

  return (
    <div
      ref={ref}
      className={cn("absolute inset-0", dragging && "[&_.react-flow__edges]:opacity-25 [&_.react-flow__edges]:transition-opacity")}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        colorMode={resolvedTheme === "light" ? "light" : "dark"}
        style={{ background: "transparent" }}
      >
        <Background gap={22} size={1.2} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" />
        <AutoFit container={ref} count={bots.length} />
      </ReactFlow>
      <Button variant="outline" size="sm" className="absolute top-4 right-4 shadow-sm" onClick={() => setCreating(true)}>
        <PlusIcon data-icon="inline-start" /> Add bot
      </Button>
      <NewBotDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
