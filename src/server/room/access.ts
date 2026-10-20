import { ClientMessageType, ServerMessageKind, StateType } from '../../shared/enums.js';
import type { RoomRole, ServerMessage } from '../../shared/types/index.js';

type Rule = readonly [method: string, path: RegExp];

/**
 * What any member (viewer and up) may read. Default deny: everything else (integrations, MCP,
 * automation, phone approvals, packs, GitHub/Sentry on the owner's tokens, room admin) is owner-only.
 */
const MEMBER_READ: readonly RegExp[] = [
  /^\/info$/,
  /^\/models$/,
  /^\/bots$/,
  /^\/bots\/[^/]+\/memory$/,
  /^\/skills$/,
  /^\/tasks$/,
  /^\/goals$/,
  /^\/goals\/[^/]+\/(changes|timeline|proof|proof\/files\/[^/]+)$/,
  /^\/goal-templates$/,
  /^\/budgets$/,
  /^\/context\/(status|graph|index|files|file|find|asks|tour|docs|module\/[^/]+)$/,
  /^\/insights$/,
  /^\/ledger$/,
  /^\/audit$/,
  /^\/security\/findings$/,
  /^\/uploads\/[A-Za-z0-9_-]+(\/meta)?$/,
  /^\/proof\/availability$/,
  /^\/settings$/,
  /^\/room\/(me|presence|comments|notifications|goal-owners)$/,
  // Multi-repo workspace: the repos and the merged map (syncing is owner-only).
  /^\/workspace(\/(graph|edges))?$/,
];

/** Writes a viewer may make: read-only computations and their own state. */
const VIEWER_WRITE: readonly Rule[] = [
  ['POST', /^\/context\/impact$/],
  ['PATCH', /^\/context\/tour$/],
  ['POST', /^\/room\/notifications\/read$/],
];

/** Writes an approver may make: decisions, discussion and starting goals. */
const APPROVER_WRITE: readonly Rule[] = [
  ['POST', /^\/goals$/],
  ['POST', /^\/goals\/[^/]+\/(approve|replan|request-changes|comments|resume|proof\/override)$/],
  ['DELETE', /^\/goals\/[^/]+\/comments\/[^/]+$/],
  ['POST', /^\/uploads$/],
  ['POST', /^\/security\/findings\/[^/]+\/resolve$/],
  ['POST', /^\/context\/ask$/],
  ['POST', /^\/room\/comments$/],
  ['DELETE', /^\/room\/comments\/[^/]+$/],
];

/** Pause or cancel: only the person who started the goal (or the owner). */
const GOAL_OWNER_WRITE = /^\/goals\/([^/]+)\/(pause|cancel)$/;

const match = (rules: readonly Rule[], method: string, path: string) => rules.some(([m, re]) => m === method && re.test(path));

/**
 * May a room member with `role` call `method path` (path relative to /api)? Default deny.
 * The owner is never limited here.
 */
export function memberMayCall(role: RoomRole, method: string, path: string, ownsGoal: (goalId: string) => boolean): boolean {
  if (role === 'owner') return true;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return MEMBER_READ.some((re) => re.test(path));
  if (match(VIEWER_WRITE, m, path)) return true;
  if (role !== 'approver') return false;
  if (match(APPROVER_WRITE, m, path)) return true;
  const own = m === 'POST' ? GOAL_OWNER_WRITE.exec(path) : null;
  return !!own && ownsGoal(decodeURIComponent(own[1]!));
}

/** WebSocket messages a member may send. Browser/bridge control and the owner's inbox state: never. */
export function memberMaySend(role: RoomRole, type: unknown): boolean {
  if (role === 'owner') return true;
  if (type === ClientMessageType.Presence) return true;
  if (role !== 'approver') return false;
  return type === ClientMessageType.Send || type === ClientMessageType.Permission || type === ClientMessageType.Answer || type === ClientMessageType.Stop;
}

const HIDDEN_STATE = new Set<string>([StateType.Mcp, StateType.Automation]);

/** Server pushes members never receive: the owner's account usage, MCP and automation setup, browser bridge commands. */
export function hiddenFromMembers(msg: ServerMessage): boolean {
  if (msg.kind === ServerMessageKind.Account || msg.kind === ServerMessageKind.BridgeCmd) return true;
  return msg.kind === ServerMessageKind.State && HIDDEN_STATE.has(msg.event.type);
}
