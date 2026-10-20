import { create } from "zustand"
import type { RoomComment, RoomGoalOwners, RoomMe, RoomNotification, RoomPresence, RoomPush } from "@shared"

interface RoomState {
  /** Who this browser is (owner or a member). Null until the server says. */
  me: RoomMe | null
  online: RoomPresence[]
  goalOwners: RoomGoalOwners
  /** Comments per goal, oldest first (loaded when a goal's Discussion opens, then live). */
  comments: Record<string, RoomComment[]>
  /** Notifications for this person only (mentions, comments on their goals). */
  notifications: RoomNotification[]
  /** This member's link was revoked or replaced. */
  removed: boolean
}

const EMPTY_OWNERS: RoomGoalOwners = {}

export const useRoomStore = create<RoomState>(() => ({
  me: null,
  online: [],
  goalOwners: EMPTY_OWNERS,
  comments: {},
  notifications: [],
  removed: false,
}))

/** Apply a live room update from the server. */
export function applyRoom(push: RoomPush) {
  switch (push.type) {
    case "me":
      return useRoomStore.setState({ me: push.me })
    case "presence":
      return useRoomStore.setState({ online: push.online })
    case "goal-owners":
      return useRoomStore.setState({ goalOwners: push.owners })
    case "notification":
      return useRoomStore.setState((s) =>
        s.notifications.some((n) => n.id === push.notification.id) ? s : { notifications: [...s.notifications, push.notification] }
      )
    case "comment":
      return useRoomStore.setState((s) => {
        const { comment, removed } = push
        const list = s.comments[comment.goalId]
        // Not loaded yet: the Discussion tab fetches the full list when it opens.
        if (!list) return s
        const next = removed ? list.filter((c) => c.id !== comment.id) : list.some((c) => c.id === comment.id) ? list : [...list, comment]
        return {
          comments: { ...s.comments, [comment.goalId]: next },
          notifications: removed ? s.notifications.filter((n) => n.commentId !== comment.id) : s.notifications,
        }
      })
  }
}

/** A teammate's browser (not the person running AgentRoom). */
export const isMember = (me: RoomMe | null) => !!me && me.role !== "owner"

/** May approve, answer and start goals (owner or approver). Unknown yet counts as yes: the server decides. */
export const canDecide = (me: RoomMe | null) => !me || me.role !== "viewer"

export const useIsMember = () => useRoomStore((s) => isMember(s.me))
export const useCanDecide = () => useRoomStore((s) => canDecide(s.me))

/** Initials for a person avatar. */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase()
}

/** A stable hue per email, so the same person always has the same colour. */
export function personHue(key: string) {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export const ROLE_LABEL: Record<RoomMe["role"], string> = { owner: "Owner", approver: "Approver", viewer: "Viewer" }
