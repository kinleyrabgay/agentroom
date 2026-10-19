/** postMessage protocol between the AgentRoom UI and the bridge script inside preview pages. */
export const BRIDGE_TAG = "__agentroom"

/** UI → page. */
export const ToPage = {
  Cmd: "cmd",
  Pick: "pick",
  Nav: "nav",
} as const

/** Page → UI. */
export const FromPage = {
  Ready: "ready",
  Console: "console",
  Result: "result",
  PickState: "pick_state",
  Picked: "picked",
} as const

export const NavAction = { Back: "back", Forward: "forward", Reload: "reload" } as const
export type NavAction = (typeof NavAction)[keyof typeof NavAction]

/** Where an iframe waits while no view shows it — kept alive and laid out at a realistic size. */
export const PARKED_STYLE: React.CSSProperties = { left: -20000, top: 0, width: 1280, height: 800, visibility: "hidden" }
export const SLOT_POLL_MS = 500

/** Pages can't navigate AgentRoom itself (no allow-top-navigation). */
export const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"

/** Limits applied to data coming from pages (untrusted). */
export const PICKED_LIMITS = { url: 500, selector: 300, label: 200, text: 500, html: 1500 } as const
