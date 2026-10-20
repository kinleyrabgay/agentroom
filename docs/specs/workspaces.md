# Multi-repo workspaces (C4)

Several repos worked on as one: one team, one board, one map. Typical case: a frontend and a backend
in separate repos, where one goal changes both.

## Using it

```bash
agentroom workspace create shop ~/code/shop-web ~/code/shop-api   # first repo is primary (or --primary <id>)
agentroom start --workspace shop
```

| Command | What it does |
|---|---|
| `agentroom workspace create <name> <path...> [--primary <repo>] [--no-map]` | Create a workspace, prepare the other repos, map every repo (facts only) |
| `agentroom workspace add <name> <path...>` | Add repos |
| `agentroom workspace remove <name> <repo>` | Remove a repo (id or folder); its files are untouched |
| `agentroom workspace primary <name> <repo>` | Choose the repo that hosts the team and board |
| `agentroom workspace list` / `show <name>` / `map <name>` / `delete <name>` | List, inspect, re-map, delete (repos stay) |
| `agentroom start --workspace <name>` | Open the workspace instead of the current folder |

Workspaces are files in `~/.agentroom/workspaces/<name>.json` (`$AGENTROOM_HOME` overrides the folder):

```json
{ "name": "shop", "repos": [{ "id": "shop-web", "path": "/abs/shop-web" }, { "id": "shop-api", "path": "/abs/shop-api" }], "primary": "shop-web" }
```

Repo ids are slugs of the folder name (`-2` on clashes). Up to 8 repos; nested folders are refused
(the outer repo would index the inner one twice).

## Model

- **Primary repo** hosts the team, board, settings, budgets, approvals, schedules, ledger and audit
  log (its `.agentroom/`, unchanged from single-repo mode). Budgets and approvals are therefore per
  workspace.
- **Other repos** keep their own `.agentroom/` for their context map and cards. `workspace create` and
  `start --workspace` only create a gitignored `.agentroom/runs/` there (no bots or settings copied);
  private repos (`.git/info/exclude`) are left alone.
- **`ProjectRegistry`** (`src/core/workspaces/registry.ts`) is the one abstraction: the primary `Project`
  plus repo refs (`id`, `root`, `primary`), opening other repos' `Project`s on demand. Single-project
  mode is a one-repo registry (`ProjectRegistry.single`), so nothing else changes when no workspace is open.
- Tasks carry `repo` (workspace repo id; unset = primary). Goals carry `repos: { <id>: { baseRef, worktree,
  worktreeWarning, pr } }` for the non-primary repos; the primary keeps `baseRef`/`worktree`/`pr`.

## Goals across repos

- The Planner gets the repo list and a rule: pass `repo` to `task_create` for every task (omit for
  the primary), one repo per task, providers before consumers (`dependsOn`). Unknown repo ids are
  rejected by the tool.
- Each repo a goal touches gets its own folder and branch (`agentroom/g-n`, same name in every repo)
  in `~/.agentroom/worktrees/<repo>-<hash>/<G-n>`, created when the first task in that repo starts.
- A task runs with `cwd` = its repo's goal folder. Extra folders (`additionalDirectories` in the
  Agent SDK): planning and plain chats get the other repos' working copies (read); build/test only
  get the goal's own folders in the other repos, never the human's working copies.
- Checkpoint commits, Changes (`GET /goals/:id/changes?repo=`), revert per task and local merge
  work per repo. The goal's report adds a decision line to the touched modules of every repo.
- **Linked PRs**: each repo's PR is opened by its own click (Open PR · repo / the PRs menu), lists only
  that repo's tasks, and starts with a "Part i of n" block linking the others. When a PR opens, the
  goal's other open PRs get the block refreshed (`gh pr edit`), audited as part of the same click.

## Context

- One `ContextService` per repo (`WorkspaceService.context(id)`); the primary's settings and daily budget
  apply to all. Status pushes are tagged with `repo`.
- Context REST routes take the repo from the `x-agentroom-repo` header (or `?repo=`); unset = primary.
  Peeks only read files indexed in that repo.
- `GET /api/workspace/graph`: every repo's modules and edges plus **cross-repo edges** inferred
  deterministically (`src/core/workspaces/cross-repo.ts`), consumer → provider:
  - `http`: route symbols from the fact graph (Hono/Express/FastAPI/Next/…) matched against path
    strings in client code (`fetch('/api/users/' + id)`, template literals, absolute URLs); a mount
    prefix of up to two segments is allowed (`/api/users/:id` → `GET /users/:id`).
  - `openapi`: paths in `openapi*`/`swagger*` YAML/JSON matched the same way (kept apart from code
    routes so an exact spec match doesn't hide the code that serves it).
  - `graphql`: `type Query/Mutation/Subscription` fields vs operations in `gql`/`graphql` code.
  - `trpc`: router keys vs `trpc.x.y.useQuery()`-style calls (every key must match).
  - `package`: package names a repo publishes (package.json, go.mod, pubspec.yaml) imported by another.
  - Edges carry up to 3 evidence lines (`file:line`, what matched). Cached per graph version.
- Bots' instructions get a workspace block: the repos and folders, the top cross-repo edges, and a capped
  slice of the other repos' `INDEX.md`.

## Safety across repos

Everything that guards a goal looks at **every repo the goal touched**, not just the primary.

- **Scans and risk.** `SecurityService.assessGoal` scans the primary diff and each other repo's goal
  folder against that repo's starting commit (`goalRepos` dep). Findings are tagged `repo` (unset =
  primary; the dedupe key includes it). The risk score is computed over all of them together: paths
  from other repos count as `<repo>/<path>`, sensitive paths are matched per repo, and one risky repo
  makes the goal risky — so a sensitive change only in a secondary repo still triggers the Security
  review and the high-risk gate.
- **Security review.** The auditor's prompt lists the other repos' diffs (folder, base commit,
  sensitive paths); `security_finding` takes an optional `repo`.
- **Publish gates.** A bot's commit/push/PR command is checked in every goal folder (it may `cd`).
  A human (or autopilot) opening a PR in a repo is refused while **that repo** has open findings at
  the team's `blockOn` threshold (rescanned first); approve or dismiss them on the Security page.
  PR drafts count each repo's own findings.
- **Autopilot.** `autopilot_report` takes `repo`; AgentRoom runs the fail→pass check in that repo
  (its goal folder for the fix, its starting commit for the base). A fix spanning several repos never
  auto-opens PRs: each waits for a person.
- **Tests and apps.** QA and build prompts say tests run in the task's repo with its own command, and
  include that repo's dev command / URL from the workspace file.
- **Proof** (recorded video/screenshots) still records the primary repo's app only; see Limits.

## Workspace settings (Settings → Workspace)

- Single-project mode: **Create workspace** (name + repo folders, first = primary) writes
  `~/.agentroom/workspaces/<name>.json` and shows `agentroom start --workspace <name>`.
- In a workspace: repos with branch and folder, **Make primary**, **Remove**, **Add a repo** (must be a
  git checkout, not nested, not a duplicate — checked on the server), and per-repo **Dev command** /
  **App URL**. Repo list and primary changes apply after a restart (a callout shows the command);
  app settings apply right away. Other saved workspaces are listed with their start command.
- ⌘K → **New workspace…** opens the section. Owner only (the team room's policy denies members).

## Cross-repo links

- Every inferred edge has a stable `key` (`kind|fromRepo|from|toRepo|to`) and a `status`: `guessed`,
  `confirmed`, or `manual`. Hidden links are left out unless `?hidden=1`.
- People's decisions live in the primary repo's **`.agentroom/context/workspace-links.json`**
  (committed, so the team shares them): `confirmed`, `hidden`, and `manual` links (both modules must
  exist; a short note; the author's name, never the email).
- Map: confirmed and manual links are solid, guessed ones dashed. The "Between repos" panel has
  Confirm / Hide / Undo per link, a **Hidden** list to bring links back, and **+** to add a link
  (repo + module on each end, optional reason).
- Bots' workspace block lists confirmed and manual links first, labels each `confirmed` or
  `guessed`, and tells bots to verify guessed ones.

## Other repos' Sentry and MCP

- **Sentry.** Projects from the other repos' committed `sentry.json` (same org as the primary's) join
  the Sentry page; issues are tagged with their repo (badge on the card) and a **Repo** filter appears.
  Another org would need its own token, so those are skipped. Handing such an issue to the team adds a
  "Where the code is" section telling the Planner to put the fix tasks in that repo.
- **MCP.** The other repos' committed team servers (`.agentroom/mcp.json`) are listed under
  *Found in Claude Code and other repos* with the repo and, for stdio servers, the exact command. Nothing
  starts on its own: **Add** copies it as a Personal server (secret references stay references; set
  the values here).
- **Settings and budgets** stay primary-only on purpose: one workspace, one set of rules.

## Review comments

- Changes comments record the repo of the diff they're on (`reviewComments[].repo`); each repo's
  Changes view shows only its own. **Request changes** creates one fix task per repo, with `repo` set.
- PR reviews from a link accept PRs of any workspace repo (matched by `origin`), check them out in
  that repo and show a repo badge.

## UI

- Sidebar header: **Repo** switcher (All repos / each repo), remembered per workspace. Hidden outside a workspace.
- **Context → Map, All repos**: the workspace map (repo frames side by side, brand edges across
  repos — solid when confirmed, dashed when guessed — and a "Between repos" panel with evidence and
  confirm/hide/add; picking one highlights it). Clicking a module switches
  to its repo and opens its card. Ask/Tour/Docs work on the repo in view.
- **Work**: repo badge on task cards, a Repo field in the task inspector, the board filtered to the
  repo in view, repo badges on goals that span repos, a repo switch in Changes, and per-repo PRs
  ("Open PR · repo" plus an "n/m PRs" menu with open/merge per repo and folder cleanup).

## API

| Route | |
|---|---|
| `GET /api/workspace` | Workspace view or `null` |
| `GET /api/workspace/graph` · `GET /api/workspace/edges` | Merged map · cross-repo edges |
| `POST /api/workspace/sync {cards?}` | Sync every repo's map (facts only by default) |
| `/api/context/*` + `x-agentroom-repo` | Any context route for one repo |
| `GET /api/goals/:id/changes?repo=` · `GET /pr-draft?repo=` · `POST /pr {repo}` · `POST /merge-local {repo}` | Per-repo goal work |
| `POST/PATCH /api/tasks` `{repo}` | Workspace repo ids only; the primary is stored as unset |
| `GET /api/workspaces` · `POST /api/workspaces {name, paths, primary?}` | Saved workspaces · create one (owner) |
| `PATCH /api/workspaces/:name? {add \| remove \| primary \| repo+devCommand/url}` | Edit a workspace (default: the running one) |
| `POST /api/workspace/links {key, action}` | `confirm` · `hide` · `reset` a link |
| `POST /api/workspace/links/manual` · `DELETE …/manual?key=` | Add or remove a manual link |
| `GET /api/sentry/issues?repo=` | One repo's Sentry projects |
| `POST /api/goals/:id/comments {repo?}` | Review comment on a repo's diff |

## Limits (partial on purpose)

- One server per workspace, run from the primary repo. Settings, budgets, GitHub board and schedules
  are the primary's. Adding/removing repos or moving the primary needs a restart.
- Proof of work records the primary repo's app only; other repos get their QA tests (in that repo)
  and the dev command / URL in prompts, but no recording.
- Sentry projects from another org than the primary's aren't shown (one token).
- Hand edits to another repo's context cards aren't watched live (they show on the next read).
- Cross-repo inference is heuristic: dynamic URLs built far from the call, gateways that rewrite
  paths, and code generated from specs at build time can be missed or mis-attributed — confirm, hide or
  add links on the map.
- Opening PRs against a real GitHub remote across repos hasn't been tested live.
