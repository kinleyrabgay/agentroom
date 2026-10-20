import { API_PREFIX, TOKEN_QUERY } from "@shared"
import { API_BASE } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

/** URL of a proof frame or GIF. The token rides in the query so <img src> works; `version` busts the cache after a re-run. */
export function proofFileUrl(goalId: string, file: string, version: string): string {
  const token = encodeURIComponent(useAppStore.getState().token)
  return `${API_BASE}${API_PREFIX}/goals/${encodeURIComponent(goalId)}/proof/files/${encodeURIComponent(file)}?${TOKEN_QUERY}=${token}&v=${encodeURIComponent(version)}`
}
