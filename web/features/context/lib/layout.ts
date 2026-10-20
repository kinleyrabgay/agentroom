import type { ContextGraphView } from "@shared"

export type Point = { x: number; y: number }

export const COL_GAP = 24
export const ROW_GAP = 72
/** Modules per row before a layer wraps (keeps the map from getting very wide). */
export const MAX_PER_ROW = 4

/** Node width by size: bigger modules read as bigger, within a narrow range. */
export function nodeWidth(files: number) {
  return Math.round(176 + Math.min(48, Math.sqrt(files) * 7))
}
export const NODE_HEIGHT = 58

/**
 * Deterministic layered layout: modules that use others sit above what they use. Cycles are
 * collapsed (strongly connected modules share a layer), layers are ordered by the barycenter of
 * their neighbours to cut crossings, and wide layers wrap into extra rows.
 */
export function layeredLayout(graph: ContextGraphView, perRow = MAX_PER_ROW): Record<string, Point> {
  const ids = graph.modules.map((m) => m.id).sort()
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  const inn = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const e of graph.edges) {
    if (e.from === e.to || !out.has(e.from) || !out.has(e.to)) continue
    out.get(e.from)!.push(e.to)
    inn.get(e.to)!.push(e.from)
  }

  // Tarjan SCC → component per node.
  const comp = new Map<string, number>()
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const on = new Set<string>()
  let i = 0
  let c = 0
  const strong = (v: string) => {
    index.set(v, i)
    low.set(v, i++)
    stack.push(v)
    on.add(v)
    for (const w of out.get(v)!) {
      if (!index.has(w)) {
        strong(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
    }
    if (low.get(v) === index.get(v)) {
      let w: string
      do {
        w = stack.pop()!
        on.delete(w)
        comp.set(w, c)
      } while (w !== v)
      c++
    }
  }
  for (const v of ids) if (!index.has(v)) strong(v)

  // Longest path from the top (components nobody depends on) in the condensed DAG.
  const cOut = new Map<number, Set<number>>()
  const cInDeg = new Map<number, number>()
  for (let k = 0; k < c; k++) {
    cOut.set(k, new Set())
    cInDeg.set(k, 0)
  }
  for (const [v, ws] of out)
    for (const w of ws) {
      const a = comp.get(v)!
      const b = comp.get(w)!
      if (a !== b && !cOut.get(a)!.has(b)) {
        cOut.get(a)!.add(b)
        cInDeg.set(b, cInDeg.get(b)! + 1)
      }
    }
  const layerOf = new Map<number, number>()
  const queue = [...cInDeg.entries()].filter(([, d]) => d === 0).map(([k]) => k)
  for (const k of queue) layerOf.set(k, 0)
  while (queue.length) {
    const k = queue.shift()!
    for (const n of cOut.get(k)!) {
      layerOf.set(n, Math.max(layerOf.get(n) ?? 0, layerOf.get(k)! + 1))
      cInDeg.set(n, cInDeg.get(n)! - 1)
      if (cInDeg.get(n) === 0) queue.push(n)
    }
  }

  const layers: string[][] = []
  for (const v of ids) (layers[layerOf.get(comp.get(v)!) ?? 0] ??= []).push(v)

  // Barycenter ordering: a few down/up sweeps.
  const order = new Map<string, number>()
  layers.forEach((row) => row.forEach((v, k) => order.set(v, k)))
  const sweep = (row: string[], neighbours: (v: string) => string[]) => {
    const score = (v: string) => {
      const ns = neighbours(v).filter((n) => order.has(n))
      return ns.length ? ns.reduce((t, n) => t + order.get(n)!, 0) / ns.length : order.get(v)!
    }
    row.sort((a, b) => score(a) - score(b) || a.localeCompare(b))
    row.forEach((v, k) => order.set(v, k))
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l < layers.length; l++) sweep(layers[l]!, (v) => inn.get(v)!)
    for (let l = layers.length - 2; l >= 0; l--) sweep(layers[l]!, (v) => out.get(v)!)
  }

  // Place: wrap wide layers, center every row.
  const width = new Map(graph.modules.map((m) => [m.id, nodeWidth(m.files)]))
  const pos: Record<string, Point> = {}
  let y = 0
  for (const row of layers) {
    if (!row?.length) continue
    for (let start = 0; start < row.length; start += perRow) {
      const chunk = row.slice(start, start + perRow)
      const total = chunk.reduce((t, v) => t + width.get(v)!, 0) + COL_GAP * (chunk.length - 1)
      let x = -total / 2
      for (const v of chunk) {
        pos[v] = { x, y }
        x += width.get(v)! + COL_GAP
      }
      y += NODE_HEIGHT + (start + perRow < row.length ? 16 : ROW_GAP)
    }
  }
  return pos
}

export interface Area {
  key: string
  label: string
  x: number
  y: number
  width: number
  height: number
  count: number
}

const AREA_GAP = 96
const AREA_PAD = 24
const AREA_HEAD = 36

/** Top folder a module lives in (`src`, `web`, …); small ones share "other". */
const areaOf = (dir: string) => (dir ? dir.split("/")[0]! : "")

/**
 * The map as areas side by side (one per top-level folder, e.g. src/ and web/), each laid out in
 * layers on its own, so a monorepo reads as its parts instead of one tall tangle.
 */
export function areaLayout(graph: ContextGraphView): { pos: Record<string, Point>; areas: Area[] } {
  const groups = new Map<string, string[]>()
  for (const m of graph.modules) groups.set(areaOf(m.dir), [...(groups.get(areaOf(m.dir)) ?? []), m.id])
  const OTHER = "\u0000other"
  for (const [k, ids] of [...groups]) {
    if (ids.length < 3 && groups.size > 1) {
      groups.delete(k)
      groups.set(OTHER, [...(groups.get(OTHER) ?? []), ...ids])
    }
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : b[1].length - a[1].length || a[0].localeCompare(b[0])))
  const byId = new Map(graph.modules.map((m) => [m.id, m]))
  // Lay out each area on its own, at the origin.
  const blocks = ordered.map(([key, ids]) => {
    const set = new Set(ids)
    const sub: ContextGraphView = { modules: ids.map((id) => byId.get(id)!), edges: graph.edges.filter((e) => set.has(e.from) && set.has(e.to)) }
    const local = layeredLayout(sub, 4)
    let minX = Infinity, maxX = -Infinity, maxY = 0
    for (const id of ids) {
      const p = local[id]!
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x + nodeWidth(byId.get(id)!.files))
      maxY = Math.max(maxY, p.y + NODE_HEIGHT)
    }
    const rel: Record<string, Point> = {}
    for (const id of ids) rel[id] = { x: AREA_PAD + (local[id]!.x - minX), y: AREA_HEAD + AREA_PAD + local[id]!.y }
    return { key, ids, rel, width: maxX - minX + AREA_PAD * 2, height: maxY + AREA_HEAD + AREA_PAD * 2 }
  })
  // Pack into columns (two once there are three areas or more): each area goes under the shortest column.
  const cols = Math.min(blocks.length, blocks.length >= 3 ? 2 : blocks.length)
  const columns = Array.from({ length: cols }, () => ({ height: 0, width: 0, items: [] as typeof blocks }))
  for (const b of blocks) {
    const col = columns.reduce((best, c) => (c.height < best.height ? c : best), columns[0]!)
    col.items.push(b)
    col.height += b.height + AREA_GAP
    col.width = Math.max(col.width, b.width)
  }
  const pos: Record<string, Point> = {}
  const areas: Area[] = []
  let x = 0
  for (const col of columns) {
    let y = 0
    for (const b of col.items) {
      for (const id of b.ids) pos[id] = { x: x + b.rel[id]!.x, y: y + b.rel[id]!.y }
      const [key] = [b.key]
      areas.push({ key, label: key === OTHER ? "other" : key ? `${key}/` : "(repo root)", x, y, width: col.width, height: b.height, count: b.ids.length })
      y += b.height + AREA_GAP
    }
    x += col.width + AREA_GAP
  }
  return { pos, areas }
}
