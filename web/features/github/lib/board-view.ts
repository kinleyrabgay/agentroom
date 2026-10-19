import type { GithubColumn, GithubItem, GithubUser } from "@shared"
import { AssigneeFilter, NO_STATUS } from "../constants"

export interface Filters {
  search: string
  assignee: AssigneeFilter
  label: string | null
  sprint: string | null
}

export function matches(item: GithubItem, f: Filters, viewer: GithubUser | null): boolean {
  if (f.assignee === AssigneeFilter.Mine && !item.assignees.some((a) => a.login === viewer?.login)) return false
  if (f.assignee === AssigneeFilter.Unassigned && item.assignees.length > 0) return false
  if (f.label && !item.labels.some((l) => l.name === f.label)) return false
  if (f.sprint && item.iteration !== f.sprint) return false
  const q = f.search.trim().toLowerCase()
  if (q) {
    const hay = `${item.title} ${item.repo ?? ""}#${item.number ?? ""} ${item.labels.map((l) => l.name).join(" ")}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

export interface ColumnView {
  column: GithubColumn
  items: GithubItem[]
}

/** Columns in GitHub order (+ "No status" when used), each with its visible items. */
export function groupByColumn(columns: GithubColumn[], hidden: string[], items: GithubItem[]): ColumnView[] {
  const known = new Set(columns.map((c) => c.id))
  const byId = new Map<string, GithubItem[]>()
  for (const item of items) {
    const key = item.statusId && known.has(item.statusId) ? item.statusId : NO_STATUS
    byId.set(key, [...(byId.get(key) ?? []), item])
  }
  const all: GithubColumn[] = [...columns]
  if (byId.has(NO_STATUS)) all.push({ id: NO_STATUS, name: "No status", color: "GRAY" })
  return all.filter((c) => !hidden.includes(c.id)).map((column) => ({ column, items: byId.get(column.id) ?? [] }))
}

/** Distinct labels and sprints across all items, for the filter selects. */
export function facets(items: GithubItem[]) {
  const labels = new Map<string, string>()
  const sprints = new Set<string>()
  for (const i of items) {
    for (const l of i.labels) labels.set(l.name, l.color)
    if (i.iteration) sprints.add(i.iteration)
  }
  return {
    labels: [...labels.entries()].map(([name, color]) => ({ name, color })).sort((a, b) => a.name.localeCompare(b.name)),
    sprints: [...sprints].sort(),
  }
}

/** Readable text color (black/white) for a GitHub label hex background. */
export function labelTextColor(hex: string): string {
  const h = hex.replace("#", "")
  if (h.length !== 6) return "inherit"
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.4 ? "#1f2328" : "#ffffff"
}

export const itemRef = (i: GithubItem) => (i.repo && i.number ? `${i.repo.split("/").pop()}#${i.number}` : "draft")

/** Detects gh auth/scope problems so the UI can show the fix command. */
export const isAuthError = (msg: string | null | undefined) =>
  !!msg && /scope|auth|token|login|gh auth|not logged|401|403|INSUFFICIENT/i.test(msg)

/** Open cards assigned to the viewer (sidebar badge). */
export function myOpenCount(items: GithubItem[] | undefined, viewer: GithubUser | null | undefined): number {
  if (!items || !viewer) return 0
  return items.filter((i) => i.state !== "CLOSED" && i.state !== "MERGED" && i.assignees.some((a) => a.login === viewer.login)).length
}
