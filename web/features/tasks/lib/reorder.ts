import type { Task } from "@shared"

/**
 * New `order` for a task dropped before `beforeId` (or at the end) of a column.
 * Uses the midpoint between neighbours so only the moved task needs saving.
 */
export function orderForDrop(
  column: Task[],
  movingId: string,
  beforeId: string | null
): number {
  const rest = column.filter((t) => t.id !== movingId)
  if (!rest.length) return 0
  if (beforeId === null) return rest[rest.length - 1].order + 1
  const i = rest.findIndex((t) => t.id === beforeId)
  if (i <= 0) return rest[0].order - 1
  return (rest[i - 1].order + rest[i].order) / 2
}
