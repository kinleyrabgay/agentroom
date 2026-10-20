# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2026-10-20

A repo context map that bots read first, and a clear sharing model: the team shares the setup, everyone keeps their own work.

### Added — Repo context map

- Fact graph built by code (no AI) for TS/JS, Python, Go, Rust, Java/Kotlin, Dart, Ruby, PHP, Swift and C#: files, exports and signatures, resolved imports (incl. tsconfig paths and workspaces), routes and tests. Grouped into modules with stable ids. Full build well under a second; incremental after that.
- Module cards written by Haiku (~2¢ each): purpose, entry points, invariants, gotchas, how to change. Every claim cites `file:line`; claims citing missing code are dropped.
- `INDEX.md` (~1.5k tokens) goes early in every bot's prompt so it stays cached, plus read-only tools `context_overview`, `context_module`, `context_find`, `context_deps` and `context_impact`.
- Stale cards are served with a warning naming the changed files. After a goal finishes, touched modules get a decision line and a debounced sync runs; only cards whose public surface or much of their code changed are rewritten.
- Context page: module map with fresh / stale / no-card status, card inspector with citations and code peek, **Wrong?** to reject a claim (the next rewrite won't repeat it), **Rules bots must follow here** notes, editable decisions, **Impact** mode, **What bots see**, code search, ⌘K entries and "Ask a bot about this module".
- `agentroom context build|sync|status|export`; `init` builds the facts. `export` writes a marked block into CLAUDE.md / AGENTS.md.
- Settings → Context (on/off, auto-sync, card model, max cards per sync). Card costs appear in the ledger as "Repo context" and respect the daily budget.
- `.agentroom/context/` is committed and shared; the fact graph is a local cache in `runs/`. `.env`, keys and credential files are never indexed.

### Changed

- Goals and tasks now live in `.agentroom/runs/board.json` (local). The old committed `.agentroom/tasks/board.json` is moved automatically the first time a project opens; commit the deletion once. A broken old file is never moved, and if both exist the new one wins with a warning.
- New schedules and triggers are personal (`.agentroom/runs/`) by default. **Team** items are committed with an owner and only run on the owner's machine, so they never run once per teammate. 0.0.2 team items without an owner are adopted by the first person who opens them; teammates can **Run it here instead** to take one over.
- Settings and config changes can be saved for **Team** or **Just me**. Personal overrides go to `runs/settings.local.json` / `runs/config.local.json` and show a **Just for you · Reset** badge. Port and permission-mode changes from the UI are personal by default.

### Added — Sharing

- `agentroom init --private` (and `start --private`) keeps `.agentroom/` out of git for just you via `.git/info/exclude`; `agentroom share` switches back. `doctor` and Settings → Data show the mode.
- Unknown `/api/*` routes now return a JSON 404 instead of the web page.

### Fixed

- Inbox crashed ("spentUsd.toFixed") when the UI talked to an older server. The client now rejects non-JSON replies, optional top-bar widgets fail quietly, and the brief checks its data.
- This repo ignores its own `.agentroom/` dogfooding folder.

## [0.0.2] - 2026-10-20

A redesign of the whole UI, Sentry and MCP integrations, and automation that lets the team work while you're away.

### Added

**Automation**

- Schedules that start a goal, message a bot or hand off GitHub cards / Sentry issues, once or repeating. Type the time in plain language in the goal box ("tomorrow at 9", "every weekday at 8:30"); Later on hand-offs; Schedule… in New goal.
- Triggers: when a new Sentry issue appears, a GitHub card moves to a column, or a goal fails, hand it to a bot, start a goal, message a bot or notify you. Limits per day, budget per run and quiet hours; stops after the plan by default.
- Automation page with schedules, triggers, run history and a Next-run pill in the top bar.
- Background mode on macOS (`agentroom daemon install|uninstall|status`, Settings → Runner); `agentroom start` reuses a running instance.
- "While you were away" brief in the Inbox and a daily Slack/Teams digest.

**Safe changes and PRs**

- Each goal works on its own branch in its own folder (outside the repo), with a commit per task and Revert task.
- Changes tab with unified/split diffs, inline review comments and Request changes.
- Open PR (adds "Closes #n" / "Fixes WEB-4X", tests and security summary), merge locally, clean up.
- Budgets per goal and per day, warning at 80% and pause at the cap.

**Integrations**

- Sentry page: issues with search, filters and sorting; issue detail with stack trace, breadcrumbs and tags; hand-off to any bot (the Team Lead starts a fix goal).
- MCP servers: Sentry presets (OAuth or token), custom servers, import from Claude Code, live status with Sign in / token / retry, and per-bot access. Bots get only these servers (`strictMcpConfig`); read-only MCP tools run without asking under ask-writes; MCP calls are audited.

**Team**

- Bot memory: bots suggest notes about the repo, you keep or ignore them.
- Goal templates: Bug fix, New endpoint, Refactor, Dependency upgrade.
- Approve from your phone over a temporary, approvals-only link with a QR code.
- Replay timeline per goal and an Insights page (results, spend, failure reasons).

**Interface**

- New design: teal brand, status tones, pill form fields, a shared component kit, and a new bot logo and favicon.
- Every view and selection has a link (`#/work/G-3/T-2`, `#/sentry/4507`); back/forward and refresh keep your place.
- ⌘K command palette for pages, bots, goals and commands.
- Inbox page for everything waiting on you, with A / D to approve or deny.
- One floating Inspector panel for bots, issues, cards and tasks.
- Approvals and bot questions are answered inline in the bot's chat.

### Changed

- Navigation: Board is now **GitHub**, Tasks is now **Work**; integrations (GitHub, Sentry, MCP servers, digests) live in Settings → Integrations.
- The UI opens on `http://localhost:<port>`; `127.0.0.1` redirects there so the in-app browser is the same site.
- Bot config saves automatically.
- Activity shows the newest tool call first.

### Fixed

- In-app browser: apps that check `location.hostname === 'localhost'` work, cross-origin API calls are forwarded with the app's own origin (CORS), and cookies and storage persist.
- Chat opens on the latest message and follows new ones; long bot-to-bot briefs are collapsed.
- Form fields are readable in light mode.
- The session token is never written to the background-mode log.

## [0.0.1] - 2026-10-19

First public release on npm as `@kinleyrabgay/agentroom`.

### Added

- Security Auditor bot and `security-review` skill.
- Security phase in goal runs (`securing`, between Build and Test), controlled by `settings.security.review` or per goal.
- Diff scanner for secrets and risky code, dependency guard with typosquat detection, and a findings store (open, approved, dismissed, fixed).
- Goal risk score (0–100) with low/medium/high levels; high-risk goals pause for approval before Test.
- Publish gate: commits, pushes and PRs wait while blocking findings are open.
- Prompt-injection guard: untrusted content is labeled, and instruction-like text is flagged.
- File attachments in chat and new goals: images, PDFs, text, and other files by path.
- Run ledger, append-only audit log, settings page, and Security and Audit pages in the UI.
- `security_finding` host tool and `/api/security/*`, `/api/uploads`, `/api/settings`, `/api/audit`, `/api/ledger` routes.

### Changed

- Setting a phase's model in `settings.json` replaces the stored choice instead of merging, so a phase can be reset.

### Included from the initial build

- `agentroom` CLI: `init`, `start`, `bot add|list`, `skill add|list`, `doctor`.
- Default team of five bots (Team Lead, Planner, Developer, QA, Reviewer) with personas.
- Built-in skills: `code-review`, `git-workflow`, `planning`, `repo-explore`, `testing`.
- Local web UI (Next.js + shadcn/ui) with live tool-call activity, per-bot chat and drag-and-drop skill assignment.
- Claude provider built on the Claude Agent SDK; `.agentroom/` loaded as a local Claude plugin.
- Goal runner: plan → review → build → test → report, with bounded fix rounds, pause and cancel.
- Shared task board with `delegate`, `task_list`, `task_create` and `task_update` tools.
- In-app browser preview with proxy, bridge script, bot cursor, element picker, console and take-control.
- GitHub Project (v2) board mirror through the `gh` CLI, with hand-off of cards to the Team Lead.
- Permission modes (`ask-writes`, `ask-all`, `auto`) and an `alwaysAsk` command list.
- Run ledger, append-only audit log, usage tracking and alerts.
- Server bound to `127.0.0.1` with a per-run access token.

[Unreleased]: https://github.com/kinleyrabgay/agentroom/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/kinleyrabgay/agentroom/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/kinleyrabgay/agentroom/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/kinleyrabgay/agentroom/releases/tag/v0.0.1
