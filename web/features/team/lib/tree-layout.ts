import type { Bot } from "@shared"

export const NODE_SPACING_X = 300
export const NODE_SPACING_Y = 260

export type Point = { x: number; y: number }

/** Org-chart layout from `reportsTo`: one row per depth, siblings centered under the root. */
export function treeLayout(bots: Bot[]): Record<string, Point> {
  const byId = new Map(bots.map((b) => [b.id, b]))
  const depth = (b: Bot, seen = new Set<string>()): number => {
    const parent = b.reportsTo ? byId.get(b.reportsTo) : undefined
    if (!parent || seen.has(b.id)) return 0
    seen.add(b.id)
    return 1 + depth(parent, seen)
  }
  const rows: Bot[][] = []
  for (const b of bots) (rows[depth(b)] ??= []).push(b)
  const pos: Record<string, Point> = {}
  rows.forEach((row, d) =>
    row.forEach((b, i) => {
      pos[b.id] = { x: (i - (row.length - 1) / 2) * NODE_SPACING_X, y: d * NODE_SPACING_Y }
    })
  )
  return pos
}
