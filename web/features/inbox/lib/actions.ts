import { ClientMessageType } from "@shared"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"

export function answerQuestion(notificationId: string, answer: string) {
  send({ type: ClientMessageType.Answer, notificationId, answer })
  // Optimistic; the server echoes the answered notification.
  useAppStore.setState((s) => ({
    notifications: s.notifications.map((n) =>
      n.id === notificationId ? { ...n, answer, read: true } : n
    ),
  }))
}

export function markRead(ids: string[]) {
  if (!ids.length) return
  send({ type: ClientMessageType.NotificationsRead, ids })
  const set = new Set(ids)
  useAppStore.setState((s) => ({
    notifications: s.notifications.map((n) =>
      set.has(n.id) ? { ...n, read: true } : n
    ),
  }))
}
