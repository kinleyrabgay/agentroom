import { API_PREFIX, TOKEN_HEADER } from "@shared"
import { API_BASE } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** JSON fetch against the AgentRoom server, authenticated with the session token. */
export async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
    method,
    headers: { "content-type": "application/json", [TOKEN_HEADER]: useAppStore.getState().token },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status)
  return data as T
}
