import { ClientMessageType, TOKEN_QUERY, WS_PATH, type ClientMessage, type ServerMessage } from "@shared"
import { projectApi, securityApi, settingsApi } from "@/lib/api/endpoints"
import { API_BASE, RECONNECT_DELAY_MS } from "@/lib/constants"
import { setFindings, useAppStore } from "@/lib/store/app-store"
import { handleServerMessage } from "./handlers"
import { reportPresence, startPresence } from "./presence"
import { roomApi } from "@/features/room/lib/room-api"
import { isMember, useRoomStore } from "@/features/room/lib/room-store"

/** Close codes: a team room member was removed, or the link stopped working. */
const WS_REMOVED = 4403
const WS_UNAUTHORIZED = 4401

let ws: WebSocket | null = null
let retry: ReturnType<typeof setTimeout> | undefined

export function send(msg: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

/** Open (and keep reopening) the live channel to the AgentRoom server. */
export function connect() {
  const { token } = useAppStore.getState()
  if (!token || ws) return

  projectApi
    .info()
    .then((info) => useAppStore.setState({ info }))
    .catch(() => {})
  // Pushed again on every change (StateType.Settings); this covers the first load.
  settingsApi
    .get()
    .then((settings) => useAppStore.setState({ settings }))
    .catch(() => {})

  // Team room: this person's mentions and comments (older servers don't have the route).
  roomApi
    .notifications()
    .then((notifications) => useRoomStore.setState({ notifications }))
    .catch(() => {})

  // Findings are pushed on change (StateType.Findings); fetch once so the badge is right from the start.
  securityApi
    .findings({})
    .then(setFindings)
    .catch(() => setFindings(null))

  const base = API_BASE ? new URL(API_BASE) : window.location
  const proto = base.protocol === "https:" ? "wss" : "ws"
  ws = new WebSocket(`${proto}://${base.host}${WS_PATH}?${TOKEN_QUERY}=${encodeURIComponent(token)}`)
  ws.onopen = () => {
    useAppStore.setState({ connected: true })
    // The focused tab executes in-app browser commands.
    if (document.hasFocus()) send({ type: ClientMessageType.Focus })
    startPresence()
    reportPresence(true)
  }
  ws.onclose = (e) => {
    ws = null
    useAppStore.setState({ connected: false })
    // A teammate's access ended: say so instead of reconnecting forever.
    if (e.code === WS_REMOVED || (e.code === WS_UNAUTHORIZED && isMember(useRoomStore.getState().me))) {
      useRoomStore.setState({ removed: true })
      return
    }
    clearTimeout(retry)
    retry = setTimeout(connect, RECONNECT_DELAY_MS)
  }
  ws.onmessage = (e) => handleServerMessage(JSON.parse(e.data) as ServerMessage)
}
