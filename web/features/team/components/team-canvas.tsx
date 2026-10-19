"use client"

import "@xyflow/react/dist/style.css"
import { useMemo, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react"
import { NetworkIcon, PlusIcon } from "lucide-react"
import { AgentEventType, BotStatus, type Bot, type StampedEvent } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { EmptyState } from "@/components/kit/state-view"
import { treeLayout } from "../lib/tree-layout"
import { AutoFit } from "./auto-fit"
import { BotNode, type BotNodeData } from "./bot-node"
import { NewBotDialog } from "./new-bot-dialog"

const nodeTypes = { bot: BotNode }

/** Gap between floating chrome and the edges of the free area. */
const SLOT_GAP = "1rem"
/** The full-bleed top bar (h-14 header with pt-2). */
const TOP_BAR = "4rem"
const INSET_AREA = { left: SLOT_GAP, top: SLOT_GAP }

/**
 * Where the canvas is not covered by the floating sidebar and top bar, from the shadcn sidebar's
 * own width variables (floating variant: the collapsed rail adds its p-2 gutter and border).
 */
function freeArea(expanded: boolean, mobile: boolean) {
  const sidebar = mobile ? "0px" : expanded ? "var(--sidebar-width)" : "calc(var(--sidebar-width-icon) + 1rem + 2px)"
  return { left: `calc(${sidebar} + ${SLOT_GAP})`, top: `calc(${TOP_BAR} + 0.5rem)` }
}

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
        style: { stroke: animated ? "var(--brand)" : "var(--border)", strokeWidth: animated ? 2 : 1.5 },
      }
    })
  return { nodes, edges }
}

/**
 * The team as a graph. `fullBleed`: drawn as the full-window background of the Team view, with the
 * sidebar, top bar, bot panel and command bar floating on top; controls are placed clear of them.
 */
export function TeamCanvas({ fullBleed = false }: { fullBleed?: boolean }) {
  const bots = useAppStore((s) => s.bots)
  const events = useAppStore((s) => s.events)
  const { resolvedTheme } = useTheme()
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useAppStore((s) => !!s.draggingSkill)
  const { state: sidebarState, isMobile } = useSidebar()
  const free = fullBleed ? freeArea(sidebarState === "expanded", isMobile) : INSET_AREA

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
        <Controls
          showInteractive={false}
          position="bottom-left"
          style={{ left: free.left, bottom: SLOT_GAP, margin: 0 }}
          className="overflow-hidden rounded-xl border shadow-sm"
        />
        <AutoFit container={ref} count={bots.length} fullBleed={fullBleed} />
      </ReactFlow>

      {/* Chrome slots: the box the sidebar and top bar leave free. */}
      <div className="pointer-events-none absolute right-0 bottom-0" style={{ left: free.left, top: free.top }}>
        <Button
          variant="outline"
          size="sm"
          className="pointer-events-auto absolute top-0 left-0 bg-background/85 shadow-sm backdrop-blur-md"
          onClick={() => setCreating(true)}
        >
          <PlusIcon data-icon="inline-start" /> Add bot
        </Button>
        {bots.length === 0 && (
          <div className="pointer-events-auto absolute inset-0 grid place-items-center">
            <EmptyState
              icon={NetworkIcon}
              title="No bots yet"
              description="A team starts with a lead. Add one, or run `agentroom init` in the repo for the default six."
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <PlusIcon data-icon="inline-start" /> Add bot
                </Button>
              }
              className="rounded-2xl border bg-background/85 shadow-sm backdrop-blur-md"
            />
          </div>
        )}
      </div>
      <NewBotDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

