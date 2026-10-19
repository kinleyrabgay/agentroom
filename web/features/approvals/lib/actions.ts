import { ClientMessageType } from "@shared"
import { send } from "@/lib/realtime/socket"

/** Answer a permission request. `always` remembers the choice for that tool group until restart. */
export function answerPermission(requestId: string, allow: boolean, always = false) {
  send({ type: ClientMessageType.Permission, requestId, allow, always })
}
