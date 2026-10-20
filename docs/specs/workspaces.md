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

## UI

- Sidebar header: **Repo** switcher (All repos / each repo), remembered per workspace. Hidden outside a workspace.
- **Context → Map, All repos**: the workspace map (repo frames side by side, dashed brand edges across
  repos, a "Between repos" panel with evidence; picking one highlights it). Clicking a module switches
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

## Limits (partial on purpose)

- One server per workspace, run from the primary repo. Other repos' GitHub boards, Sentry config, MCP
  servers and settings are not read; the workspace uses the primary's.
- Security scans, the risk score, proof of work and the publish gates run on the primary repo's diff
  only; other repos' diffs are visible in Changes but not scanned.
- Review comments in Changes don't record which repo a file is in.
- Hand edits to another repo's context cards aren't watched live (they show on the next read).
- Cross-repo inference is heuristic: dynamic URLs built far from the call, gateways that rewrite
  paths, and code generated from specs at build time can be missed or mis-attributed.
- No workspace UI for creating/editing workspaces yet (CLI only).
