import { toast } from "sonner"
import { securityApi } from "@/lib/api/endpoints"
import { setFindings, useAppStore } from "@/lib/store/app-store"

/** Scan the working tree (or one goal's diff); findings arrive via the realtime push too. */
export async function runScan(goalId?: string) {
  try {
    const result = await securityApi.scan(goalId)
    const found = Array.isArray(result) ? result : []
    // Refresh the list in case the server doesn't push (or pushes later).
    setFindings(await securityApi.findings({}))
    toast.success(found.length ? `Scan found ${found.length} ${found.length === 1 ? "issue" : "issues"}` : "Scan found nothing", {
      description: goalId ? `For ${goalId}` : "Working tree",
    })
  } catch (e) {
    toast.error(`Scan failed: ${(e as Error).message}`)
  }
}

export async function resolveFinding(id: string, status: "approved" | "dismissed", note?: string) {
  try {
    const updated = await securityApi.resolve(id, status, note)
    if (updated && typeof updated === "object" && "id" in updated)
      useAppStore.setState((s) => ({ findings: s.findings.map((f) => (f.id === id ? updated : f)) }))
    toast.success(status === "approved" ? "Risk approved" : "Finding dismissed")
    return true
  } catch (e) {
    toast.error((e as Error).message)
    return false
  }
}
