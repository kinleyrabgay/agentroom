import type { BridgeActor, BridgeCmd } from "@shared"

/** Delivers a bot's browser command to its preview iframe. Registered by the preview host. */
export type BridgeDispatcher = (botId: string, id: string, cmd: BridgeCmd, actor: BridgeActor) => void

let dispatcher: BridgeDispatcher | null = null

export function setBridgeDispatcher(fn: BridgeDispatcher | null) {
  dispatcher = fn
}

export function getBridgeDispatcher() {
  return dispatcher
}
