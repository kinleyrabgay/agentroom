import type { RoomGraphView } from "@shared"
import { areaLayout, NODE_HEIGHT, nodeWidth, type Area, type Point } from "@/features/context/lib/layout"

/** Node id of a module on the room map. */
export const roomNodeId = (repo: string, module: string) => `${repo}::${module}`
export const splitRoomNodeId = (id: string): { repo: string; module: string } => {
  const i = id.indexOf("::")
  return { repo: id.slice(0, i), module: id.slice(i + 2) }
}

export interface RepoFrame {
  repo: string
  name: string
  primary: boolean
  built: boolean
  x: number
  y: number
  width: number
  height: number
  modules: number
}

const FRAME_PAD = 32
const FRAME_HEAD = 56
const FRAME_GAP = 200
/** Width of a repo frame that has no map yet. */
const EMPTY_WIDTH = 320
const EMPTY_HEIGHT = 160

/**
 * The room map: each repo laid out on its own (its folders as areas, like the single-repo map),
 * inside a frame, frames side by side with the primary repo first, so edges between repos run
 * across the gaps.
 */
export function roomLayout(graph: RoomGraphView): { pos: Record<string, Point>; areas: (Area & { repo: string })[]; frames: RepoFrame[] } {
  const pos: Record<string, Point> = {}
  const areas: (Area & { repo: string })[] = []
  const frames: RepoFrame[] = []
  let x = 0
  const ordered = [...graph.repos].sort((a, b) => Number(b.primary) - Number(a.primary))
  for (const r of ordered) {
    if (!r.built || !r.modules.length) {
      frames.push({ repo: r.id, name: r.name, primary: r.primary, built: r.built, x, y: 0, width: EMPTY_WIDTH, height: EMPTY_HEIGHT, modules: 0 })
      x += EMPTY_WIDTH + FRAME_GAP
      continue
    }
    const local = areaLayout({ modules: r.modules, edges: r.edges })
    let maxX = 0
    let maxY = 0
    for (const a of local.areas) {
      maxX = Math.max(maxX, a.x + a.width)
      maxY = Math.max(maxY, a.y + a.height)
    }
    for (const m of r.modules) {
      const p = local.pos[m.id] ?? { x: 0, y: 0 }
      maxX = Math.max(maxX, p.x + nodeWidth(m.files))
      maxY = Math.max(maxY, p.y + NODE_HEIGHT)
      pos[roomNodeId(r.id, m.id)] = { x: x + FRAME_PAD + p.x, y: FRAME_HEAD + p.y }
    }
    for (const a of local.areas) areas.push({ ...a, key: `${r.id}:${a.key}`, repo: r.id, x: x + FRAME_PAD + a.x, y: FRAME_HEAD + a.y })
    const width = maxX + FRAME_PAD * 2
    frames.push({ repo: r.id, name: r.name, primary: r.primary, built: true, x, y: 0, width, height: maxY + FRAME_HEAD + FRAME_PAD, modules: r.modules.length })
    x += width + FRAME_GAP
  }
  return { pos, areas, frames }
}
