"use client"

import "@xyflow/react/dist/style.css"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useTheme } from "next-themes"
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react"
import { ArrowRightIcon, CableIcon, FolderGit2Icon, Loader2Icon, RefreshCwIcon, WaypointsIcon } from "lucide-react"
import { toast } from "sonner"
import type { CrossRepoEdge, CrossRepoKind, WorkspaceGraphView } from "@shared"
import { cn } from "@/lib/utils"
import { workspaceApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { ToneBadge } from "@/components/kit/badge"
import type { Tone } from "@/components/kit/tone"
import { ErrorState, LoadingState } from "@/components/kit/state-view"
import { PageActions } from "@/components/layout/page-actions"
import { AreaNode, ModuleNode, type AreaNodeData, type ModuleNodeData } from "@/features/context/components/module-node"
import { openModule, setContextTab } from "@/features/context/lib/context-store"
import { selectRepo, useWorkspaceStore } from "../lib/workspace-store"
import { workspaceLayout, workspaceNodeId, splitWorkspaceNodeId, type RepoFrame } from "../lib/workspace-layout"

const KIND: Record<CrossRepoKind, { label: string; tone: Tone }> = {
  http: { label: "HTTP", tone: "brand" },
  openapi: { label: "OpenAPI", tone: "brand" },
  graphql: { label: "GraphQL", tone: "info" },
  trpc: { label: "tRPC", tone: "info" },
  package: { label: "Package", tone: "neutral" },
}

type FrameNodeData = { frame: RepoFrame }

/** A repo's frame behind its folders and modules. */
const RepoFrameNode = memo(function RepoFrameNode({ data, width, height }: NodeProps<Node<FrameNodeData>>) {
  const f = data.frame
  return (
    <div style={{ width, height }} className="pointer-events-none rounded-[2rem] border bg-surface/60 shadow-xs">
      <div className="flex items-center gap-2 px-7 pt-5">
        <FolderGit2Icon className="size-4 text-muted-foreground" />
        <span className="text-base font-semibold tracking-tight">{f.name}</span>
        {f.primary && <ToneBadge size="sm" tone="brand">primary</ToneBadge>}
        <span className="text-xs text-muted-foreground">{f.built ? `${f.modules} modules` : "not mapped yet"}</span>
      </div>
    </div>
  )
})

const nodeTypes = { module: ModuleNode, area: AreaNode, frame: RepoFrameNode }

/** The whole workspace: every repo's map side by side, with the edges between repos drawn across. */
export function WorkspaceMap() {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const [graph, setGraph] = useState<WorkspaceGraphView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(() => {
    workspaceApi
      .graph()
      .then((g) => {
        setGraph(g)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const mapAll = () => {
    setSyncing(true)
    workspaceApi
      .sync(false)
      .then(() => {
        toast.success("Mapping every repo", { description: "Facts only: files, symbols, imports. No model calls." })
        // Facts take seconds per repo; pick the result up as it lands.
        for (const ms of [2500, 6000, 12000]) setTimeout(load, ms)
        setTimeout(() => setSyncing(false), 12000)
      })
      .catch((e: Error) => {
        toast.error(e.message)
        setSyncing(false)
      })
  }

  const unmapped = graph?.repos.filter((r) => !r.built).length ?? 0
  return (
    <div className="absolute inset-0">
      <PageActions>
        <Button size="sm" variant="outline" onClick={load} title="Reload the workspace map">
          <RefreshCwIcon data-icon="inline-start" /> Refresh
        </Button>
        <Button size="sm" onClick={mapAll} disabled={syncing} title="Update every repo's facts (no model calls)">
          {syncing ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <WaypointsIcon data-icon="inline-start" />}
          {unmapped ? `Map ${unmapped} ${unmapped === 1 ? "repo" : "repos"}` : "Update all maps"}
        </Button>
      </PageActions>
      {error && !graph ? (
        <ErrorState error={error} onRetry={load} />
      ) : !graph || !workspace ? (
        <LoadingState label="Drawing the workspace…" />
      ) : (
        <WorkspaceCanvas graph={graph} />
      )}
    </div>
  )
}

function WorkspaceCanvas({ graph }: { graph: WorkspaceGraphView }) {
  const { resolvedTheme } = useTheme()
  const [hover, setHover] = useState<string | null>(null)
  const [pinned, setPinned] = useState<CrossRepoEdge | null>(null)
  const { pos, areas, frames } = useMemo(() => workspaceLayout(graph), [graph])

  const allEdges = useMemo(() => {
    const intra = graph.repos.flatMap((r) => r.edges.map((e) => ({ from: workspaceNodeId(r.id, e.from), to: workspaceNodeId(r.id, e.to), weight: e.weight, cross: null as CrossRepoEdge | null })))
    const cross = graph.crossEdges.map((e) => ({ from: workspaceNodeId(e.fromRepo, e.from), to: workspaceNodeId(e.toRepo, e.to), weight: e.weight, cross: e }))
    return [...intra, ...cross]
  }, [graph])

  const focus = useMemo(() => {
    if (pinned) return new Set([workspaceNodeId(pinned.fromRepo, pinned.from), workspaceNodeId(pinned.toRepo, pinned.to)])
    if (!hover) return null
    const set = new Set([hover])
    for (const e of allEdges) {
      if (e.from === hover) set.add(e.to)
      if (e.to === hover) set.add(e.from)
    }
    return set
  }, [hover, pinned, allEdges])

  const nodes: Node[] = useMemo(
    () => [
      ...frames.map(
        (f): Node<FrameNodeData> => ({
          id: `frame:${f.repo}`,
          type: "frame",
          position: { x: f.x, y: f.y },
          width: f.width,
          height: f.height,
          data: { frame: f },
          selectable: false,
          draggable: false,
          focusable: false,
          zIndex: -2,
        })
      ),
      ...areas.map(
        (a): Node<AreaNodeData> => ({
          id: `area:${a.key}`,
          type: "area",
          position: { x: a.x, y: a.y },
          width: a.width,
          height: a.height,
          data: { label: a.label, count: a.count },
          selectable: false,
          draggable: false,
          focusable: false,
          zIndex: -1,
        })
      ),
      ...graph.repos.flatMap((r) =>
        r.modules.map((m): Node<ModuleNodeData> => {
          const id = workspaceNodeId(r.id, m.id)
          return { id, type: "module", position: pos[id] ?? { x: 0, y: 0 }, data: { module: m, active: false, dim: !!focus && !focus.has(id), impact: null } }
        })
      ),
    ],
    [frames, areas, graph.repos, pos, focus]
  )

  const edges: Edge[] = useMemo(() => {
    const max = Math.max(1, ...allEdges.map((e) => e.weight))
    return allEdges.map((e) => {
      const lit = !!focus && focus.has(e.from) && focus.has(e.to) && (!pinned || !!e.cross)
      const faded = !!focus && !lit
      const color = e.cross ? "var(--brand)" : lit ? "var(--brand)" : "var(--border)"
      return {
        id: `${e.from}->${e.to}${e.cross ? `:${e.cross.kind}` : ""}`,
        source: e.from,
        target: e.to,
        type: "default",
        style: {
          stroke: color,
          strokeWidth: e.cross ? 1.5 + (e.weight / max) * 2.5 : 0.75 + (e.weight / max) * 2.25,
          strokeDasharray: e.cross ? "6 5" : undefined,
          opacity: faded ? 0.12 : e.cross ? 0.9 : 1,
          transition: "opacity 150ms",
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
        zIndex: e.cross ? 2 : lit ? 1 : 0,
      }
    })
  }, [allEdges, focus, pinned])

  const open = (nodeId: string) => {
    const { repo, module } = splitWorkspaceNodeId(nodeId)
    selectRepo(repo)
    setContextTab("map")
    openModule(module)
  }

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        minZoom={0.08}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        onNodeClick={(_, n) => n.type === "module" && open(n.id)}
        onNodeMouseEnter={(_, n) => n.type === "module" && setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
        onPaneClick={() => setPinned(null)}
        proOptions={{ hideAttribution: true }}
        colorMode={resolvedTheme === "light" ? "light" : "dark"}
        style={{ background: "transparent" }}
      >
        <Background gap={22} size={1.2} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" className="overflow-hidden rounded-xl border shadow-sm" />
      </ReactFlow>
      <p className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-background/85 px-3 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur-md">
        Every repo in the workspace. Click a module to open its card in that repo; Ask, Tour and Docs work per repo.
      </p>
      <CrossEdgesPanel edges={graph.crossEdges} repos={graph.repos} pinned={pinned} onPick={setPinned} />
    </div>
  )
}

/** Edges between repos, with what matched; picking one highlights it on the map. */
function CrossEdgesPanel({ edges, repos, pinned, onPick }: { edges: CrossRepoEdge[]; repos: WorkspaceGraphView["repos"]; pinned: CrossRepoEdge | null; onPick: (e: CrossRepoEdge | null) => void }) {
  const name = (id: string) => repos.find((r) => r.id === id)?.name ?? id
  /** `repo · folder` the way people know a module. */
  const where = (repo: string, module: string) => {
    const dir = repos.find((r) => r.id === repo)?.modules.find((m) => m.id === module)?.dir
    return `${name(repo)} · ${dir === undefined ? module : dir ? `${dir}/` : "./"}`
  }
  return (
    <div className="absolute right-3 bottom-3 z-10 flex max-h-[min(420px,calc(100%-1.5rem))] w-[min(380px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border bg-background/90 shadow-sm backdrop-blur-md">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <CableIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Between repos</span>
        <span className="text-xs text-muted-foreground tabular-nums">{edges.length}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <svg width="22" height="6" aria-hidden className="text-brand">
            <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" />
          </svg>
          across repos
        </span>
      </div>
      {!edges.length ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No links found yet. AgentRoom matches API routes and OpenAPI specs to the paths clients call, GraphQL and tRPC operations, and shared packages.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {edges.map((e) => {
            const active = pinned === e
            return (
              <li key={`${e.fromRepo}:${e.from}->${e.toRepo}:${e.to}:${e.kind}`}>
                <button
                  onClick={() => onPick(active ? null : e)}
                  aria-pressed={active}
                  className={cn("flex w-full flex-col gap-1 px-4 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:outline-none", active && "bg-accent/70")}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span className="truncate font-mono">{where(e.fromRepo, e.from)}</span>
                    <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono">{where(e.toRepo, e.to)}</span>
                    <ToneBadge size="sm" tone={KIND[e.kind].tone} className="ml-auto">
                      {KIND[e.kind].label} · {e.weight}
                    </ToneBadge>
                  </span>
                  {e.evidence[0] && (
                    <span className="truncate font-mono text-[11px] text-muted-foreground" title={e.evidence.map((v) => `${v.file}${v.line ? `:${v.line}` : ""}  ${v.detail}`).join("\n")}>
                      {e.evidence[0].file}
                      {e.evidence[0].line ? `:${e.evidence[0].line}` : ""} · {e.evidence[0].detail}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
