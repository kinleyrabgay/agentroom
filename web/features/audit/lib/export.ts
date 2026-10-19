import type { AuditEntry } from "@shared"

/** Download entries as JSON Lines (one entry per line), built in the browser. */
export function downloadJsonl(entries: AuditEntry[], name = `agentroom-audit-${new Date().toISOString().slice(0, 10)}.jsonl`) {
  const blob = new Blob([entries.map((e) => JSON.stringify(e)).join("\n") + "\n"], { type: "application/x-ndjson" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
