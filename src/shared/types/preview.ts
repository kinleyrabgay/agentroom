import type { BridgeOp, ConsoleLevel } from '../enums.js';

/** A bot's in-app preview: the page runs in an iframe inside the AgentRoom UI, served through a small proxy. */
export interface PreviewState {
  /** Origin of the real site, e.g. http://localhost:3000 */
  target: string;
  /** Origin of the AgentRoom proxy for that site, e.g. http://127.0.0.1:53121 */
  proxy: string;
  /** Path + query + hash currently loaded (or requested). */
  path: string;
  title: string;
  /** Bumped on every navigation the server requests, so the UI reloads the iframe. */
  nav: number;
  /** While true, the bot's browser actions wait for the human to hand back control. */
  humanControl: boolean;
}

export interface ConsoleLine {
  level: ConsoleLevel;
  text: string;
  ts: number;
}

/** Commands executed by the bridge script inside the preview page. */
export type BridgeCmd =
  | { op: typeof BridgeOp.Snapshot }
  | { op: typeof BridgeOp.Click; ref: string }
  | { op: typeof BridgeOp.Type; ref: string; text: string; submit?: boolean }
  | { op: typeof BridgeOp.Press; key: string }
  | { op: typeof BridgeOp.WaitFor; text: string; timeoutMs: number }
  | { op: typeof BridgeOp.Back }
  | { op: typeof BridgeOp.Eval; code: string };

/** Identity drawn on the bot's cursor inside the page. */
export interface BridgeActor {
  name: string;
  color: string;
}

/** An element the human picked in a preview, attached to the next chat message. */
export interface PickedElement {
  url: string;
  selector: string;
  label: string;
  text: string;
  html: string;
}
