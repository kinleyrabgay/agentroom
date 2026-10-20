import { ClientMessageType } from "@shared"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { toast } from "sonner"
import { canDecide, isMember, useRoomStore } from "@/features/room/lib/room-store"

export function answerQuestion(notificationId: string, answer: string) {
  if (!canDecide(useRoomStore.getState().me)) return void toast.error("Viewers can't answer the bots' questions.")
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
  // The inbox's read state is the owner's; a teammate's view of it stays local to their tab.
  if (!isMember(useRoomStore.getState().me)) send({ type: ClientMessageType.NotificationsRead, ids })
  const set = new Set(ids)
  useAppStore.setState((s) => ({
    notifications: s.notifications.map((n) =>
      set.has(n.id) ? { ...n, read: true } : n
    ),
  }))
}
