import { API_PREFIX, REPO_HEADER, TOKEN_HEADER } from "@shared"
import { API_BASE } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Multi-repo rooms: the repo context requests are about (null = the primary repo). Set by the repo switcher. */
let contextRepo: string | null = null
export function setContextRepo(repo: string | null) {
  contextRepo = repo
}

/** JSON fetch against the AgentRoom server, authenticated with the session token. */
export async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      [TOKEN_HEADER]: useAppStore.getState().token,
      ...(contextRepo && path.startsWith("/context") ? { [REPO_HEADER]: contextRepo } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  // An older server answers API paths it doesn't know with the web page (HTML, 200). Treat any
  // non-JSON reply as "not supported" so optional features fail quietly instead of reading `{}`.
  const json = (res.headers.get("content-type") ?? "").includes("application/json")
  const data = json ? await res.json().catch(() => undefined) : undefined
  if (!res.ok) throw new ApiError((data as { error?: string } | undefined)?.error ?? res.statusText, res.status)
  if (data === undefined) throw new ApiError("This AgentRoom server doesn't support that yet. Restart `agentroom start` to update it.", 404)
  return data as T
}
