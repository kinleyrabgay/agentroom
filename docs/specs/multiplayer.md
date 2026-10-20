# Shared team room (D3): spec

Teammates join the owner's AgentRoom from their own browser to watch, approve, comment and start goals. **The owner's machine executes everything**: bots, git, tokens and secrets never leave it. Sharing is opt-in and off by default; LAN and tunnel exposure are separate, explicit switches that reset to off on every restart.

## Roles

| Role | Can |
|---|---|
| **Owner** | Everything. The person running `agentroom start`; identified by the session token, accepted **only from this machine**. |
| **Approver** | Read the room. Approve/deny permission requests, answer bot questions, approve/re-plan plans, request changes, resume gates, override proof checks, resolve security findings, start goals, message bots, Stop, comment, ask the codebase. Pause/cancel **only goals they started**. |
| **Viewer** | Read only: goals, tasks, changes, timeline, proof, context map, insights, audit, security findings, comments. May run impact analysis and track their own tour progress. |

Members never get: settings writes, integrations/secrets, MCP, automation, phone approvals, packs/registry, GitHub/Sentry (they run on the owner's tokens), bots/skills editing, PR/merge/cleanup, the in-app browser and its bridge, room admin.

Enforcement is **server-side, default deny** (`src/server/room/access.ts`):
- REST: `memberMayCall(role, method, path)`; an allow-list per role. Anything not listed is refused with 403.
- WebSocket: `memberMaySend(role, type)`. Viewers: presence only. Approvers: + `send`, `permission`, `answer`, `stop`. Nobody but the owner sends browser/bridge, focus or inbox-read messages.
- Pushes: members never receive the owner's account usage, MCP or automation state, or bridge commands (`hiddenFromMembers`). A member tab is never the hub's primary (bridge) tab and never counts as "the human is here" for away-only alerts.
- Role changes take effect immediately (the current role is looked up on every request and message, not read from the link).

## Identity and links

- Invite = name + git email + role + lifetime (1, 7, 30 or 90 days). Stored locally in `.agentroom/runs/room.json` (0600, never committed).
- Link token: `arm1.<claims>.<HMAC-SHA256>` with claims `{ m: memberId, j: linkId, e: expiry }`, signed with `roomSecret` in `runs/secrets.json` (generated on first use, 32 random bytes). The token itself is never stored; it's shown once.
- A token is valid only if: the room is on, the signature checks, it hasn't expired, the member exists, isn't removed, isn't expired, and `j` equals their current link id.
- **New link** replaces the old one (old link and its open sockets stop immediately). **Remove** revokes (sockets close with code 4403). **Reset all links** rotates the signing key.
- Every authenticated request runs inside an `AsyncLocalStorage` context; `humanName()` returns `Name <email>` for members, so the audit log, findings, approvals and ask history are attributed to the person who acted.

## Transport

- **This machine**: `http://localhost:<port>/?t=<member token>` (useful for testing).
- **Local network** (Settings → Team room → Local network): an extra listener bound to the chosen non-internal IPv4 address on the same port. Never on by default, never restored after a restart. Requests from other machines must carry `Host: <bound address>:<port>` (DNS-rebinding guard, else 421).
- **Internet**: a dedicated Cloudflare quick tunnel (reuses `startCloudflared`). While it's on, the tunnel guard lets the UI and API through; the API still requires a member link.
- The owner's session token is refused over the LAN listener and through any tunnel, so a leaked start URL can't be used remotely.

## Abuse protection

- Failed sign-ins: 20 per minute per source (`cf-connecting-ip` through the tunnel, peer address otherwise) → 429 for the rest of the window.
- Member requests and WS messages: 600 per minute per member.
- Members' REST calls must be same-origin when an `Origin` header is present (403 otherwise); member WebSockets must be same-origin.
- `cache-control: no-store` on authenticated API responses.

## Features

- **Presence**: top bar avatar stack (shown when someone else is connected, or always for members) with a popover listing people, roles and whether their tab is focused. Members see their role chip and a **Leave** action.
- **Goal owner**: goals started while the room is on record their starter (`goalOwners` in `room.json`); shown as a chip in the goal header. Lets approvers pause/cancel their own goals.
- **Comments** (`Discussion` tab on a goal, visible once the room is on): comment on the goal or its plan, @mention by full name, first name or email name. Plain text only (never rendered as HTML).
- **Per-person notifications**: mentions and comments on a goal you started (owner by default) are stored per recipient and pushed only to that person's tabs; Inbox → **For you**. Reading a goal's discussion marks them read.
- **Members' UI**: owner-only pages are hidden from the sidebar and redirected away from (deep links, ⌘K); owner-only controls (review mode, publish/PR, delete, add task/bot, usage, next run) are hidden; viewers get no composer, approval or goal actions and a read-only note in Discussion.
- **Access ended**: a revoked/replaced/expired link shows a full-screen "Your access to this room ended" instead of reconnecting forever.

## API

Owner only: `GET /api/room`, `POST /api/room/enable|disable|rotate`, `POST /api/room/lan {on, address?}`, `POST /api/room/tunnel {on}`, `POST /api/room/members {name, email, role, days}` → invite with links + QR, `PATCH /api/room/members/:id {role}`, `POST /api/room/members/:id/link {days?}`, `DELETE /api/room/members/:id`.

Everyone: `GET /api/room/me|presence|goal-owners|notifications`, `GET /api/room/comments?goalId=`, `POST /api/room/comments {goalId, target, body}` (approver+), `DELETE /api/room/comments/:id` (author or owner), `POST /api/room/notifications/read {ids?}`.

WebSocket: `ServerMessageKind.Room` with `{ type: 'me' | 'presence' | 'comment' | 'notification' | 'goal-owners' }`.

## Files

- Server: `src/server/room/{access,auth,principal,room.service,socket,tokens}.ts`, `src/server/http/routes/room.routes.ts`.
- Shared: `src/shared/types/room.ts`; `ServerMessageKind.Room`; `IntegrationSecrets.roomSecret`.
- Web: `web/features/room/*` (store, API, Settings → Team room, presence, discussion, For you).
- Tests: `test/room.test.ts`.

## Known gaps

- Members can't use the in-app Browser (preview proxies run on the owner's loopback ports).
- Per-person notifications are in-app only (no email/OS alerts for members yet).
- Comment edit isn't supported (delete and re-post).
- Remote sharing beyond a quick tunnel (stable URL, SSO) is the cloud relay's job (see `cloud-runner.md`).
