import { FindingSeverity, FindingStatus, type SecurityFinding } from "@shared"
import { SEVERITY_META } from "../constants"

export interface FindingFilters {
  goalId: string | null
  severity: FindingSeverity | null
  status: FindingStatus | null
  category: string | null
  search: string
}

export const DEFAULT_FILTERS: FindingFilters = {
  goalId: null,
  severity: null,
  status: FindingStatus.Open,
  category: null,
  search: "",
}

export function filterFindings(findings: SecurityFinding[], f: FindingFilters): SecurityFinding[] {
  const q = f.search.trim().toLowerCase()
  return findings
    .filter(
      (x) =>
        (!f.goalId || x.goalId === f.goalId) &&
        (!f.severity || x.severity === f.severity) &&
        (!f.status || x.status === f.status) &&
        (!f.category || x.category === f.category) &&
        (!q || `${x.title} ${x.detail} ${x.file ?? ""} ${x.rule}`.toLowerCase().includes(q))
    )
    .sort(bySeverityThenNewest)
}

export const bySeverityThenNewest = (a: SecurityFinding, b: SecurityFinding) =>
  SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank || b.ts.localeCompare(a.ts)

export interface FindingCounts {
  openCritical: number
  openWarning: number
  approved: number
  dismissed: number
  fixed: number
}

export function countFindings(findings: SecurityFinding[], goalId?: string | null): FindingCounts {
  const c: FindingCounts = { openCritical: 0, openWarning: 0, approved: 0, dismissed: 0, fixed: 0 }
  for (const f of findings) {
    if (goalId && f.goalId !== goalId) continue
    if (f.status === FindingStatus.Open) {
      if (f.severity === FindingSeverity.Critical) c.openCritical++
      else if (f.severity === FindingSeverity.Warning) c.openWarning++
    } else if (f.status === FindingStatus.Approved) c.approved++
    else if (f.status === FindingStatus.Dismissed) c.dismissed++
    else if (f.status === FindingStatus.Fixed) c.fixed++
  }
  return c
}

/** "git push", "git commit" or "PR" — what a security gate is guarding. */
export function gateAction(command: string): string {
  if (/\bgh\s+pr\s+create\b/.test(command)) return "opening a PR"
  if (/\bgit\s+push\b/.test(command)) return "git push"
  if (/\bgit\s+commit\b/.test(command)) return "git commit"
  return "this command"
}

export const location = (f: SecurityFinding) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : null)
