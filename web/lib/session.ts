import { TOKEN_QUERY } from "@shared"
import { TOKEN_STORAGE_KEY } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

/** Read the session token from the URL once, keep it in sessionStorage, and strip it from the address bar. */
export function initSessionToken(): string {
  const url = new URL(window.location.href)
  let token = url.searchParams.get(TOKEN_QUERY) ?? ""
  if (token) {
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } catch {}
    url.searchParams.delete(TOKEN_QUERY)
    window.history.replaceState(null, "", url)
  } else {
    try {
      token = sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? ""
    } catch {}
  }
  useAppStore.setState({ token, tokenChecked: true })
  return token
}
