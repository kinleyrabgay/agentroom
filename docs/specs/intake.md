# Intake: Microsoft Teams, Linear, Jira, PR review from a link

Milestone 0.2 of the [platform plan](../platform-plan.md). Work now arrives from where the team already
is, and every write outside AgentRoom is either clicked by a human or allowed by a rule they turned on.

## Microsoft Teams (A1)

Built without an Azure bot registration:

| Direction | Mechanism | Auth |
|---|---|---|
| In | A channel's **outgoing webhook**: `@AgentRoom …` → `POST /teams/inbound` | HMAC-SHA256 of the raw body with the webhook's security token (`Authorization: HMAC …`), plus an allow-list of Azure AD object ids |
| Back (same message) | Synchronous reply (Adaptive Card) within Teams' 5 s limit | — |
| Out (later updates) | A **Workflows** webhook ("Post to a channel when a webhook request is received") with Adaptive Cards | URL stored in local secrets (`teamsWebhook`, also used by digests) |

What people can type (after `@AgentRoom`):

| Message | Who | Effect |
|---|---|---|
| free text, e.g. `add CSV export to reports` | members, approvers | Starts a goal (stops after the plan by default) |
| text with `ENG-123`, `WEB-4X` or `#45` | members, approvers | Resolves the reference through the connected sources (Linear, Jira, Sentry, GitHub board) and hands it off; the result is posted when ready |
| `status` / `pending` / `help` | members, approvers | Open goals / what's waiting (plans, permission requests with short codes) |
| `approve G-12`, `changes G-12 <feedback>` | approvers | Approve or re-plan a goal |
| `allow <code>`, `deny <code>` | approvers | Answer a permission request (security-held ones still need AgentRoom) |

Updates posted for Teams-started goals (or all goals with *Post updates for every goal*): plan ready
(with the commands to approve), building/testing, paused, PR ready, done, failed. At most one card per
goal every 15 s; the latest state wins.

**Approvals are typed commands, not buttons.** Webhook cards can't call back (no `Action.Submit`).
Linking the phone-approval page (`/m?r=<token>`) into a channel would hand the remote token to everyone
in it, and the approver's name would be lost. Typed commands come through the signed webhook with the
sender's AAD id, so each decision is audited as `Teams: Name <email>`.

**Safety.** Unsigned or wrongly signed requests get 401; disabled = 404. Replays of the same activity id
are ignored. People not on the list get a reply with their id and are listed in Settings for one-click
adding; nothing runs for them. Inbound text goes through the prompt-injection detector: a message that
reads like instructions to the bots is refused, recorded as a security finding and in the audit log.
Through the tunnel only `/m`, `/remote-api/*` and `/teams/inbound` answer. Rate limit: 30 requests a
minute per client.

Design: `IntakeService` (`src/server/intake/intake.service.ts`) is chat-tool agnostic: it takes a
verified user + text and returns a reply card. `TeamsService` is one adapter; a Slack or Bot Framework
adapter only has to verify the sender and render cards.

### Setup (Settings → Integrations → Microsoft Teams)

1. **Public address.** Teams needs HTTPS. Use a tunnel with a fixed name forwarding to AgentRoom's port
   (named `cloudflared` tunnel, reserved ngrok domain, reverse proxy) and paste its base URL. Without it,
   the phone-approvals quick tunnel works too, but its URL changes on every start.
2. **Outgoing webhook.** Team → ⋯ → Manage team → Apps → *Create an outgoing webhook*. Name it AgentRoom,
   paste the callback URL shown in step 1, create, and paste the security token Teams shows once.
3. **Workflow webhook.** Channel → ⋯ → Workflows → *Post to a channel when a webhook request is
   received* → pick the channel → paste the URL. *Send a test card* posts only when clicked.
4. **People.** Add each person (AAD object id, name, optional git identity for the audit log, role).
   Easiest: have them mention the bot once; they appear under *Asked recently* with an Add button.
5. **Behaviour.** *Stop after the plan* (default on) and *Post updates for every goal* (default off).
   Then switch Teams on.

Files: `.agentroom/integrations/teams.json` (committed: enabled, people and roles, behaviour, public
URL); `runs/secrets.json` (`teamsOutgoingSecret`, `teamsWebhook`); `runs/teams.json` (goal ↔ requester,
seen activity ids, unknown senders).

## Linear and Jira (A2)

- **`IssueSource`** (`src/server/integrations/issues/issue-source.ts`): `list`, `matches(ref)`,
  `find(ref)`, `handoff`, optional `transition`/`comment`. GitHub board, Sentry, Linear and Jira all
  implement it. Automation hand-offs and Teams references go through it, so a new tracker is one adapter.
- **Pages:** Sources → Linear / Jira (shown once a team/project is configured). Issues grouped by state,
  search, State / Assignee / Show filters, multi-select hand-off, Inspector with description, comments,
  *Move to* (a click = one audited write) and the hand-off form (Now / Later).
- **Hand-off:** the lead starts a goal with `sources: [{ type: 'issue', tracker, key, … }]`; the issue
  text and comments are wrapped as untrusted data. The PR body gets `Fixes ENG-123` (Linear closes it;
  Jira links it).
- **Status sync (opt-in, off by default):** move to a state when the goal starts building, move when the
  PR opens, comment the PR link. Every write is in the audit log as a sync rule; failures land in the
  Inbox.
- **Triggers:** *When a Linear/Jira issue moves to <state>* (polled every 5 minutes, first look only
  records the snapshot), with the same actions and limits as GitHub/Sentry triggers.
- **Auth:** Linear personal API key; Jira Cloud email + API token (REST v3, `search/jql`). Credentials in
  `runs/secrets.json`; team/project, site, JQL filter and sync rules in
  `.agentroom/integrations/{linear,jira}.json`.

## PR review from a link (A3)

Sources → **PR reviews** (or ⌘K *Review a pull request…*):

1. Paste a PR link (`https://github.com/o/r/pull/n`, `o/r#n` or `#n`). Only PRs of this project's repo.
2. AgentRoom checks it out in its own folder (`~/.agentroom/worktrees/<repo>-<hash>/pr-<n>`, via
   `git worktree add --detach` + `gh pr checkout --detach`) and saves `gh pr diff`.
3. The Reviewer bot (role `reviewer`, or pick another) reads the description and diff (both wrapped as
   untrusted), can use the `context_*` tools, and answers with JSON: summary, suggested event, inline
   comments. Comments on lines outside the diff become *Other notes*.
4. You edit everything in the diff viewer: summary, notes, add/edit/delete comments on any diff line.
5. **Post review** (Comment / Request changes / Approve) asks for confirmation, then
   `gh api POST repos/o/r/pulls/n/reviews` with the head commit. Audited as a GitHub write by you.

**Fork PRs:** while the bot reviews a PR from a fork, every shell command it tries needs your approval
(sticky, never "Always allow"), and it's told not to run the PR's scripts. *Allow scripts and re-run* is
an explicit, audited decision; commands still ask.

Files: `runs/reviews.json`, `runs/reviews/<id>.diff`. *Remove the checkout folder* cleans up.

## API

| Area | Routes |
|---|---|
| Trackers | `GET /trackers` · `GET /trackers/:id` · `PUT/DELETE /trackers/:id/credentials` · `GET /trackers/:id/scopes` · `PUT /trackers/:id/config` · `GET /trackers/:id/issues` · `GET /trackers/:id/issues/:issue` · `POST /trackers/:id/handoff` · `POST /trackers/:id/issues/:issue/move` |
| Teams | `GET /teams` · `PUT /teams/config` · `PUT /teams/secrets` · `POST /teams/test` · public `POST /teams/inbound` (HMAC) |
| Reviews | `GET/POST /reviews` · `GET/PATCH/DELETE /reviews/:id` · `POST /reviews/:id/rerun` · `POST /reviews/:id/post` · `POST /reviews/:id/cleanup` |

## Not done / later

- Slack (dropped in favour of Teams) and a full Bot Framework bot: both fit behind `IntakeService`.
- Replies in the same Teams thread for later updates (Workflows posts new channel messages).
- Webhooks from Linear/Jira (polling now); they need the cloud relay or a public URL.
- PR-review trigger ("when a PR gets label `agentroom-review`").
- PRs from other repos than the project's.
