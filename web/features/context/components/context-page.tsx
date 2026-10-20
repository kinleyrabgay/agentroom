"use client"

import "@xyflow/react/dist/style.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Background, Controls, MarkerType, ReactFlow, useReactFlow, type Edge, type Node } from "@xyflow/react"
import { ChevronDownIcon, CrosshairIcon, EyeIcon, Loader2Icon, RefreshCwIcon, SettingsIcon, WaypointsIcon } from "lucide-react"
import type { ContextStatus } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { contextApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState, ErrorState, LoadingState } from "@/components/kit/state-view"
import { ToneDot } from "@/components/kit/badge"
import { PageActions } from "@/components/layout/page-actions"
import { areaLayout } from "../lib/layout"
import { CARD_STATUS } from "../lib/meta"
import { loadGraph, openModule, setContext, setContextTab, useContextStore, type ContextTab } from "../lib/context-store"
import { Segmented, type SegmentedOption } from "@/components/kit/segmented"
import { AskPage } from "./ask-page"
import { DocsPage } from "./docs-page"
import { TourPage } from "./tour-page"
import { startSync } from "../lib/actions"
import { AreaNode, ModuleNode, type AreaNodeData, type ModuleNodeData } from "./module-node"
import { ContextSearch } from "./context-search"
import { ImpactPanel } from "./impact-panel"
import { CodePeekDialog } from "./code-peek"
import { IndexDialog } from "./index-dialog"

const nodeTypes = { module: ModuleNode, area: AreaNode }

/** The repo map (`#/context`): modules, their cards, and what depends on what. */
export function ContextPage() {
  const status = useContextStore((s) => s.status)
  const graph = useContextStore((s) => s.graph)
  const graphError = useContextStore((s) => s.graphError)
  const tab = useContextStore((s) => s.tab)

  useEffect(() => {
    if (!useContextStore.getState().status)
      contextApi
        .status()
        .then((status) => setContext({ status }))
        .catch((e) => setContext({ graphError: (e as Error).message }))
  }, [])
  useEffect(() => {
    if (status?.built && !useContextStore.getState().graph) void loadGraph()
  }, [status?.built])

  return (
    <div className="absolute inset-0">
      <PageActions>{status?.built && <Toolbar status={status} />}</PageActions>
      {graphError && !status ? (
        <ErrorState error={graphError} onRetry={() => location.reload()} />
      ) : !status ? (
        <LoadingState label="Loading the repo map…" />
      ) : !status.enabled ? (
        <Disabled />
      ) : !status.built ? (
        <NotBuilt status={status} />
      ) : tab === "ask" ? (
        <AskPage />
      ) : tab === "tour" ? (
        <TourPage />
      ) : tab === "docs" ? (
        <DocsPage />
      ) : graphError && !graph ? (
        <ErrorState error={graphError} onRetry={() => void loadGraph()} />
      ) : !graph ? (
        <LoadingState label="Drawing the map…" />
      ) : (
        <Canvas status={status} />
      )}
      <CodePeekDialog />
      <IndexDialog />
    </div>
  )
}

function Disabled() {
  return (
    <EmptyState
      icon={WaypointsIcon}
      title="Repo context is off"
      description="Bots explore the repo themselves on every task. Turn context on to give them a map of modules, cards and dependencies instead."
      action={
        <Button size="sm" variant="outline" onClick={() => useAppStore.getState().showSettings("context")}>
          <SettingsIcon data-icon="inline-start" /> Context settings
        </Button>
      }
    />
  )
}

function NotBuilt({ status }: { status: ContextStatus }) {
  const progress = status.progress
  return (
    <EmptyState
      icon={WaypointsIcon}
      title="Map this repo for your bots"
      description="AgentRoom reads the code (files, symbols, imports, tests) and groups it into modules. Bots get a short map in their instructions and look up the rest, instead of spending tokens exploring."
      action={
        status.syncing ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> {progress?.message ?? "Indexing…"}
          </span>
        ) : (
          <>
            <Button size="sm" onClick={() => startSync({ cards: false })}>
              <WaypointsIcon data-icon="inline-start" /> Build the map
            </Button>
            <span className="basis-full pt-1 text-xs text-muted-foreground">Takes seconds and costs nothing. Module cards are a separate step.</span>
          </>
        )
      }
    />
  )
}

const TAB_OPTIONS: SegmentedOption<ContextTab>[] = [
  { value: "map", label: "Map" },
  { value: "ask", label: "Ask" },
  { value: "tour", label: "Tour" },
  { value: "docs", label: "Docs" },
]

function Toolbar({ status }: { status: ContextStatus }) {
  const impactOn = useContextStore((s) => s.impactOn)
  const tab = useContextStore((s) => s.tab)
  const sha = status.indexedSha?.slice(0, 7)
  return (
    <>
      <Segmented size="sm" value={tab} onChange={setContextTab} options={TAB_OPTIONS} aria-label="Context view" />
      {tab === "map" && <MapTools status={status} sha={sha} impactOn={impactOn} />}
      {/* On a phone the tabs need the room; search and sync stay on the map. */}
      {tab !== "map" && (
        <div className="hidden md:contents">
          <ContextSearch />
          <SyncButton status={status} />
        </div>
      )}
      {tab === "map" && <SyncButton status={status} />}
    </>
  )
}

function MapTools({ status, sha, impactOn }: { status: ContextStatus; sha?: string; impactOn: boolean }) {
  return (
    <>
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums 2xl:inline" title={status.indexedAt ?? undefined}>
        {sha ? <span className="font-mono">{sha}</span> : "no git"}
        {status.indexedAt ? ` · ${timeAgo(Date.parse(status.indexedAt))}` : ""}
      </span>
      <ContextSearch />
      <Button
        size="sm"
        variant="outline"
        aria-pressed={impactOn}
        className={cn(impactOn && "tone-brand tone-soft")}
        onClick={() => {
          // The blast radius needs the room the Inspector takes.
          if (!impactOn) openModule(null)
          setContext({ impactOn: !impactOn })
        }}
        title="Pick files to see everything that depends on them"
      >
        <CrosshairIcon data-icon="inline-start" /> Impact
      </Button>
      <Button size="sm" variant="outline" onClick={() => setContext({ indexOpen: true })} title="The map every bot gets in its instructions">
        <EyeIcon data-icon="inline-start" /> What bots see
      </Button>
    </>
  )
}

function SyncButton({ status }: { status: ContextStatus }) {
  const todo = status.cards.missing + status.cards.stale
  return (
    <div className="flex items-center">
      <Button size="sm" className="rounded-r-none" disabled={status.syncing} onClick={() => startSync({})} title={todo ? `Update the map and write up to the per-sync limit of ${todo} cards that need it` : "Update the map"}>
        {status.syncing ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
        {status.syncing ? "Syncing…" : "Sync"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="rounded-l-none border-l border-l-primary-foreground/20 px-2" disabled={status.syncing} aria-label="More sync options">
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={() => startSync({ cards: false })}>
            <div>
              <p>Update facts only</p>
              <p className="text-xs text-muted-foreground">Files, symbols, deps. No model calls.</p>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => startSync({ full: true })}>
            <div>
              <p>Full rebuild</p>
              <p className="text-xs text-muted-foreground">Re-read every file, then write cards that need it.</p>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => useAppStore.getState().showSettings("context")}>
            <SettingsIcon /> Context settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function Canvas({ status }: { status: ContextStatus }) {
  const graph = useContextStore((s) => s.graph)!
  const openId = useContextStore((s) => s.openModuleId)
  const impactOn = useContextStore((s) => s.impactOn)
  const impact = useContextStore((s) => s.impact)
  const impactFiles = useContextStore((s) => s.impactFiles)
  const [hover, setHover] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  const ref = useRef<HTMLDivElement>(null)

  const { pos: positions, areas } = useMemo(() => areaLayout(graph), [graph])
  const neighbours = useMemo(() => {
    const focus = hover ?? openId
    if (!focus) return null
    const set = new Set([focus])
    for (const e of graph.edges) {
      if (e.from === focus) set.add(e.to)
      if (e.to === focus) set.add(e.from)
    }
    return { focus, set }
  }, [hover, openId, graph.edges])

  const changedModules = useMemo(() => {
    if (!impactOn || !impact) return null
    const changed = new Set<string>()
    const owner = new Map<string, string>()
    for (const m of graph.modules) owner.set(m.dir, m.id)
    for (const f of impactFiles) {
      let best = ""
      let id: string | undefined
      for (const [dir, mid] of owner) if ((dir === "" || f.startsWith(dir + "/")) && dir.length >= best.length) [best, id] = [dir, mid]
      if (id) changed.add(id)
    }
    return { changed, affected: new Set(impact.modules) }
  }, [impactOn, impact, impactFiles, graph.modules])

  const nodes: Node<ModuleNodeData | AreaNodeData>[] = useMemo(
    () => [
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
      ...graph.modules.map((m): Node<ModuleNodeData> => ({
        id: m.id,
        type: "module",
        position: positions[m.id] ?? { x: 0, y: 0 },
        data: {
          module: m,
          active: m.id === openId,
          dim: changedModules ? !changedModules.affected.has(m.id) && !changedModules.changed.has(m.id) : !!neighbours && !neighbours.set.has(m.id),
          impact: changedModules?.changed.has(m.id) ? "changed" : changedModules?.affected.has(m.id) ? "affected" : null,
        },
      })),
    ],
    [graph.modules, areas, positions, openId, neighbours, changedModules]
  )

  const edges: Edge[] = useMemo(() => {
    const max = Math.max(1, ...graph.edges.map((e) => e.weight))
    return graph.edges.map((e) => {
      const lit = neighbours ? e.from === neighbours.focus || e.to === neighbours.focus : false
      const faded = (!!neighbours && !lit) || !!changedModules
      const color = lit ? "var(--brand)" : "var(--border)"
      return {
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        type: "default",
        style: { stroke: color, strokeWidth: 0.75 + (e.weight / max) * 2.25, opacity: faded ? 0.15 : 1, transition: "opacity 150ms" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
        zIndex: lit ? 1 : 0,
      }
    })
  }, [graph.edges, neighbours, changedModules])

  return (
    <div ref={ref} className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.15}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        onNodeClick={(_, n) => n.type === "module" && openModule(n.id === openId ? null : n.id)}
        onNodeMouseEnter={(_, n) => n.type === "module" && setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
        onPaneClick={() => openModule(null)}
        proOptions={{ hideAttribution: true }}
        colorMode={resolvedTheme === "light" ? "light" : "dark"}
        style={{ background: "transparent" }}
      >
        <Background gap={22} size={1.2} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" className="overflow-hidden rounded-xl border shadow-sm" />
        <FocusView ids={changedModules ? [...changedModules.changed, ...changedModules.affected] : []} />
        <KeepInView id={changedModules ? null : openId} container={ref} />
      </ReactFlow>

      {status.syncing && <SyncProgress status={status} />}
      <Legend status={status} />
      {impactOn && <ImpactPanel />}
    </div>
  )
}

function SyncProgress({ status }: { status: ContextStatus }) {
  const p = status.progress
  const value = p?.total ? Math.round(((p.done ?? 0) / p.total) * 100) : undefined
  return (
    <div className="absolute top-3 left-1/2 z-10 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-md">
      <div className="flex items-center gap-2 text-xs">
        <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {p?.phase === "cards" ? "Writing cards" : (p?.message ?? "Syncing")}
          {p?.phase === "cards" && p.moduleId ? <span className="text-muted-foreground"> · {p.moduleId}</span> : null}
        </span>
        {p?.total ? (
          <span className="text-muted-foreground tabular-nums">
            {p.done ?? 0}/{p.total}
          </span>
        ) : null}
      </div>
      <Progress value={value ?? 15} className={cn("mt-2 h-1", value === undefined && "animate-pulse")} />
    </div>
  )
}

/** Card counts double as the legend for the status dots. */
function Legend({ status }: { status: ContextStatus }) {
  const s = status.cards
  return (
    <div style={{ right: "calc(var(--inspector-space, 0px) + 0.75rem)" }} className="absolute bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-full transition-[right] duration-200 border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-md">
      {(["fresh", "stale", "missing"] as const).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5" title={CARD_STATUS[k].hint}>
          <ToneDot tone={CARD_STATUS[k].tone} />
          {CARD_STATUS[k].label} <span className="text-muted-foreground tabular-nums">{s[k]}</span>
        </span>
      ))}
      <span className="hidden text-muted-foreground sm:inline">
        · {status.modules} modules · {status.files} files
      </span>
      {s.missing > 0 && !status.syncing && (
        <button className="font-medium text-brand hover:underline" onClick={() => startSync({})} title={`About $${status.estimateUsd.toFixed(2)} for all ${s.missing}; each sync writes up to the limit in Settings`}>
          Write cards
        </button>
      )}
    </div>
  )
}

/** In impact mode, brings the blast radius into view. */
function FocusView({ ids }: { ids: string[] }) {
  const { fitView } = useReactFlow()
  const key = ids.join(",")
  useEffect(() => {
    if (!key) return
    // Keep clear of the impact panel on the left.
    const t = setTimeout(
      () => void fitView({ nodes: key.split(",").map((id) => ({ id })), padding: { left: "400px", right: "48px", top: "48px", bottom: "72px" }, maxZoom: 1, duration: 300 }),
      50
    )
    return () => clearTimeout(t)
  }, [key, fitView])
  return null
}

/** Pans (same zoom) so the open module isn't hidden under the Inspector. */
function KeepInView({ id, container }: { id: string | null; container: React.RefObject<HTMLDivElement | null> }) {
  const { fitView, getZoom, getNode, getViewport } = useReactFlow()
  useEffect(() => {
    if (!id || !container.current) return
    const t = setTimeout(() => {
      const el = container.current
      const node = getNode(id)
      if (!el || !node) return
      const inspector = parseFloat(getComputedStyle(el).getPropertyValue("--inspector-space")) || 0
      const { x, zoom } = getViewport()
      const left = node.position.x * zoom + x
      const right = left + (node.measured?.width ?? 200) * zoom
      if (left >= 16 && right <= el.clientWidth - inspector - 16) return
      const z = getZoom()
      void fitView({ nodes: [{ id }], padding: { right: `${inspector + 48}px`, left: "48px", top: "48px", bottom: "48px" }, minZoom: z, maxZoom: z, duration: 300 })
    }, 260)
    return () => clearTimeout(t)
  }, [id, container, fitView, getZoom, getNode, getViewport])
  return null
}
