import type { RoomComment, RoomCommentTarget, RoomGoalOwners, RoomInvite, RoomMe, RoomMemberView, RoomNotification, RoomPresence, RoomStatus } from "@shared"
import { request } from "@/lib/api/client"

const seg = encodeURIComponent

/** Team room: admin (owner only) and what every member uses. */
export const roomApi = {
  status: () => request<RoomStatus>("GET", "/room"),
  enable: () => request<RoomStatus>("POST", "/room/enable"),
  disable: () => request<RoomStatus>("POST", "/room/disable"),
  lan: (on: boolean, address?: string) => request<RoomStatus>("POST", "/room/lan", { on, ...(address ? { address } : {}) }),
  tunnel: (on: boolean) => request<RoomStatus>("POST", "/room/tunnel", { on }),
  invite: (input: { name: string; email: string; role: "approver" | "viewer"; days: number }) => request<RoomInvite>("POST", "/room/members", input),
  setRole: (id: string, role: "approver" | "viewer") => request<RoomMemberView>("PATCH", `/room/members/${seg(id)}`, { role }),
  reissue: (id: string, days?: number) => request<RoomInvite>("POST", `/room/members/${seg(id)}/link`, days ? { days } : {}),
  revoke: (id: string) => request<RoomMemberView>("DELETE", `/room/members/${seg(id)}`),
  rotate: () => request<RoomStatus>("POST", "/room/rotate"),

  me: () => request<RoomMe>("GET", "/room/me"),
  presence: () => request<RoomPresence[]>("GET", "/room/presence"),
  goalOwners: () => request<RoomGoalOwners>("GET", "/room/goal-owners"),
  comments: (goalId: string) => request<RoomComment[]>("GET", `/room/comments?goalId=${seg(goalId)}`),
  comment: (goalId: string, body: string, target: RoomCommentTarget) => request<RoomComment>("POST", "/room/comments", { goalId, body, target }),
  removeComment: (id: string) => request<{ ok: true }>("DELETE", `/room/comments/${seg(id)}`),
  notifications: () => request<RoomNotification[]>("GET", "/room/notifications"),
  markRead: (ids?: string[]) => request<{ ok: true }>("POST", "/room/notifications/read", ids ? { ids } : {}),
}
