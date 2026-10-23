import {
  AgentEventType,
  applyRateLimit,
  applyUsage,
  ClientMessageType,
  ServerMessageKind,
  StateType,
  type ServerMessage,
  type StateEvent,
} from "@shared"
import { MAX_CONSOLE_LINES } from "@/lib/constants"
import { setFindings, useAppStore, type AppState } from "@/lib/store/app-store"
import { applyDelta, EMPTY_LIVE, settleLive } from "@/lib/store/live-reply"
import { getBridgeDispatcher } from "./bridge-dispatch"
import { emitNotification } from "./notification-bus"
import { send } from "./socket"
import { normalizeGoals, normalizeTasks } from "./normalize"
import { applyContextStatus } from "@/features/context/lib/context-store"
import { applyRoom } from "@/features/room/lib/room-store"
import { contextPushInView } from "@/features/workspaces/lib/workspace-store"

const set = useAppStore.setState

/** Apply one server message to the store. */
export function handleServerMessage(msg: ServerMessage) {
  switch (msg.kind) {
    case ServerMessageKind.Hello:
      set({
        events: msg.history,
        statuses: msg.statuses,
        usage: msg.usage,
        account: msg.account,
        previews: msg.previews,
        consoles: msg.consoles,
        notifications: msg.notifications ?? [],
        queues: msg.queues ?? {},
      })
      return

    case ServerMessageKind.Queue:
      set((s) => ({ queues: { ...s.queues, [msg.botId]: msg.queue } }))
      return

    case ServerMessageKind.Event: {
      const ev = msg.event
      set((s) => {
        const next: Partial<AppState> = { events: [...s.events, ev] }
        if (ev.type === AgentEventType.BotStatus) next.statuses = { ...s.statuses, [ev.botId]: { status: ev.status, activity: ev.activity } }
        if (ev.type === AgentEventType.Usage) next.usage = applyUsage(s.usage, ev)
        if (ev.type === AgentEventType.RateLimit) next.usage = applyRateLimit(s.usage, ev)
        const live = settleLive(s.live, ev)
        if (live) next.live = live
        return next
      })
      return
    }

    case ServerMessageKind.State:
      applyState(msg.event)
      return

    case ServerMessageKind.Stream:
      set((s) => ({ live: { ...s.live, [msg.botId]: applyDelta(s.live[msg.botId] ?? EMPTY_LIVE, msg.delta) } }))
      return

    case ServerMessageKind.Preview:
      set((s) => {
        const previews = { ...s.previews }
        const consoles = { ...s.consoles }
        if (msg.state) previews[msg.botId] = msg.state
        else {
          delete previews[msg.botId]
          delete consoles[msg.botId]
        }
        return { previews, consoles }
      })
      return

    case ServerMessageKind.Console:
      set((s) => ({
        consoles: { ...s.consoles, [msg.botId]: [...(s.consoles[msg.botId] ?? []), msg.line].slice(-MAX_CONSOLE_LINES) },
      }))
      return

    case ServerMessageKind.BridgeCmd: {
      const dispatch = getBridgeDispatcher()
      if (dispatch) dispatch(msg.botId, msg.id, msg.cmd, msg.actor)
      else send({ type: ClientMessageType.BridgeResult, id: msg.id, ok: false, error: "The preview is not mounted in the AgentRoom UI." })
      return
    }

    case ServerMessageKind.Account:
      set({ account: msg.account })
      return

    case ServerMessageKind.Notification: {
      const n = msg.notification
      const isNew = !useAppStore.getState().notifications.some((x) => x.id === n.id)
      set((s) => ({
        notifications: isNew ? [...s.notifications, n] : s.notifications.map((x) => (x.id === n.id ? n : x)),
      }))
      if (isNew) emitNotification(n)
      return
    }

    case ServerMessageKind.Room:
      applyRoom(msg.room)
      return
  }
}

function applyState(ev: StateEvent) {
  switch (ev.type) {
    case StateType.Bots:
      return set({ bots: ev.bots })
    case StateType.Skills:
      return set({ skills: ev.skills })
    case StateType.Tasks:
      return set({ tasks: normalizeTasks(ev.tasks) })
    case StateType.Goals:
      return set({ goals: normalizeGoals(ev.goals) })
    case StateType.Settings:
      return set({ settings: ev.settings })
    case StateType.Findings:
      return setFindings(ev.findings)
    case StateType.Automation:
      return set({ automation: ev.automation })
    case StateType.Context:
      // Multi-repo workspaces push every repo's status; only the repo in view applies.
      return contextPushInView(ev.repo) ? applyContextStatus(ev.context) : undefined
    case StateType.Mcp:
      return set({ mcp: ev.mcp })
    case StateType.Config:
      return set((s) => ({ info: s.info ? { ...s.info, config: ev.config, model: ev.config.model } : s.info }))
  }
}
