/**
 * Shared team room: teammates join the owner's AgentRoom over the LAN or a tunnel.
 * The owner's machine executes everything; members watch, approve and comment.
 */

/** owner: the person running AgentRoom. approver: approve, plan, comment, start goals. viewer: read only. */
export type RoomRole = 'owner' | 'approver' | 'viewer';

/** Who is making a request. */
export interface RoomIdentity {
  /** `owner` for the host; otherwise the member id. */
  id: string;
  name: string;
  email: string;
  role: RoomRole;
}

/** A teammate invited to the room (stored locally in `runs/room.json`). */
export interface RoomMember {
  id: string;
  name: string;
  email: string;
  role: Exclude<RoomRole, 'owner'>;
  createdAt: string;
  expiresAt: string;
  /** Id of the only valid link; issuing a new link invalidates the old one. */
  tokenId: string;
  revokedAt?: string;
  lastSeenAt?: string;
}

export type RoomMemberState = 'active' | 'expired' | 'revoked';

export interface RoomMemberView extends Omit<RoomMember, 'tokenId'> {
  state: RoomMemberState;
  online: boolean;
}

export interface RoomTunnelStatus {
  state: 'off' | 'starting' | 'on' | 'error';
  url?: string;
  error?: string;
  missingBinary?: boolean;
}

export interface RoomLanStatus {
  enabled: boolean;
  /** Address the LAN listener is bound to (only while enabled). */
  address?: string;
  url?: string;
  error?: string;
  /** Non-internal IPv4 interfaces you can share on. */
  interfaces: { name: string; address: string }[];
}

/** GET /api/room (owner only). */
export interface RoomStatus {
  /** Sharing on: member links work. Off: every member link is refused. */
  enabled: boolean;
  port: number;
  lan: RoomLanStatus;
  tunnel: RoomTunnelStatus;
  members: RoomMemberView[];
  owner: { name: string; email: string };
}

/** A fresh invite link for one member (shown once; the token isn't stored). */
export interface RoomInvite {
  member: RoomMemberView;
  links: { local: string; lan?: string; tunnel?: string };
  /** QR of the best link for a phone or another laptop's camera. */
  qrSvg?: string;
}

/** GET /api/room/me: who this browser is. */
export interface RoomMe extends RoomIdentity {
  roomEnabled: boolean;
  expiresAt?: string;
}

/** Someone connected right now. */
export interface RoomPresence extends RoomIdentity {
  /** Their tab is visible and focused. */
  active: boolean;
  since: string;
}

export type RoomCommentTarget = 'goal' | 'plan';

export interface RoomComment {
  id: string;
  goalId: string;
  target: RoomCommentTarget;
  author: RoomIdentity;
  body: string;
  /** Member ids (or `owner`) mentioned with @name. */
  mentions: string[];
  createdAt: string;
}

/** A notification for one person (mentions, comments on goals they own). */
export interface RoomNotification {
  id: string;
  /** Recipient: member id or `owner`. */
  to: string;
  kind: 'mention' | 'comment';
  goalId: string;
  commentId: string;
  from: string;
  text: string;
  createdAt: string;
  read: boolean;
}

/** Who started a goal (only recorded for goals started while the room was in use). */
export type RoomGoalOwners = Record<string, { id: string; name: string; email: string }>;

/** Live room updates over the WebSocket (ServerMessageKind.Room). */
export type RoomPush =
  | { type: 'me'; me: RoomMe }
  | { type: 'presence'; online: RoomPresence[] }
  | { type: 'comment'; comment: RoomComment; removed?: boolean }
  | { type: 'notification'; notification: RoomNotification }
  | { type: 'goal-owners'; owners: RoomGoalOwners };
