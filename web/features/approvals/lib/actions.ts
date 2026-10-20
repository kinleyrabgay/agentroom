import { ClientMessageType } from "@shared"
import { toast } from "sonner"
import { send } from "@/lib/realtime/socket"
import { canDecide, useRoomStore } from "@/features/room/lib/room-store"

/** Answer a permission request. `always` remembers the choice for that tool group until restart. */
export function answerPermission(requestId: string, allow: boolean, always = false) {
  if (!canDecide(useRoomStore.getState().me)) return void toast.error("Viewers can follow along, but approvals are up to approvers and the owner.")
  send({ type: ClientMessageType.Permission, requestId, allow, always })
}
