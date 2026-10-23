# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.4] - 2026-10-23

Six platform milestones since 0.0.3 (proof, intake, packs, knowledge, autopilot, engine), the shared team room, multi-repo workspaces, and a chat and appearance pass. The chat, parallel-build and appearance work takes ideas from [PandaCode](https://github.com/aicodeking/pandacode), reimplemented for AgentRoom (no code copied; notes in `docs/research/pandacode.md`).

### Added — Proof of work and quality gates

- New goal phase **Verify** (Plan → Review → Build → Security → Test → Verify → Report). QA writes a browser scenario once; the engine starts the app from the goal's folder, records it in headless Chrome and encodes a GIF, optionally with before/after screenshots from the starting commit.
- Quality checks: accessibility (new issues vs the base), performance (warn only), visual diff, and opt-in coverage and bundle size. Failing checks raise the risk score and pause at the quality gate; **Accept and continue** is audited.
- A broken scenario becomes a Bug task and another fix round. The PR body gets a Proof section; images go to the orphan `agentroom/proof` branch or stay local.
- Proof tab, Settings → Proof and Quality, a doctor check. Spec: `docs/specs/proof.md`.

### Added — Intake

- **Microsoft Teams** without an Azure bot: an HMAC-verified outgoing webhook in, Adaptive Cards out (plan ready, progress, PR, done/failed). Approvals are typed commands from allow-listed approvers, audited by name.
- **Linear** and **Jira Cloud** tracker pages with filters and hand-off, opt-in status sync, "issue moved to state" triggers and `Fixes KEY` in PRs.
- **PR review from a link:** the PR is checked out in its own worktree, the Reviewer drafts comments you edit in a diff viewer, and they're posted with `gh` only when you click. Fork PRs force approval for every shell command. Spec: `docs/specs/intake.md`.

### Added — Team packs and skill registry

- Built-in **Next.js SaaS** and **Flutter** packs (bots, skills, goal templates, sensitive paths) with stack detection; `agentroom init --pack` and `agentroom pack list|add|update|remove`. Updates three-way merge with your edits; conflicts keep your file.
- Skill registry: index registries (sha256-verified), skills.sh search, GitHub and file imports. Every skill is shown in full before install and nothing is ever executed; `agentroom skill install|update|validate|publish`. Spec: `docs/specs/packs.md`.

### Added — Knowledge

- **Ask the codebase:** a read-only bot answers from the context map with citations checked against the code, flags when it's unsure, and can turn an answer into a goal.
- Generated `docs/architecture.md` and `docs/decisions.md`, written section by section only on click, and an **onboarding tour** with progress per person. Spec: `docs/specs/knowledge.md`.

### Added — Shared team room

- Teammates join from their own browser to watch, approve and comment; this machine still runs everything. Roles owner / approver / viewer are enforced on the server for every request and message.
- Per-person signed, expiring links; local-network and Cloudflare-tunnel access are separate switches, off by default and after every restart. Presence, goal Discussion with @mentions, per-person notifications. Spec: `docs/specs/multiplayer.md`.

### Added — Autopilot and design match

- **Sentry incident autopilot:** a reproduce-first goal on new issues or spikes. AgentRoom checks the test itself (fails on the starting commit, passes on the fix) and scores confidence; a PR opens on its own only when every switch, the score and the check allow it. Off by default. Spec: `docs/specs/autopilot.md`.
- **Implement a design:** a goal template with a Figma frame or an uploaded image; Verify renders the page at the frame size and scores it against the design, with a diff image and a design gate.

### Added — Engine

- **Multiple providers** (experimental): Codex, Gemini CLI and any OpenAI-compatible endpoint, per phase with a fallback chain and Claude as the last resort. A run falls back only if it failed before any tool call.
- **Learning loop:** goal outcomes, A/B experiments on a bot's skills or instructions, suggestions applied only on click, and read-only replay evals under a budget cap. Insights → Experiments. Spec: `docs/specs/engine.md`.

### Added — Multi-repo workspaces

- One team, one board and one map across several repos: `agentroom workspace create|add|remove|primary|list|show|map|delete` and `agentroom start --workspace`. Goals plan and build per repo with their own folders, branches, checkpoints and linked PRs.
- Security scans, the dependency guard, risk, publish gates and autopilot cover every repo a goal touched. Settings → Workspace, cross-repo links on the map, Sentry and MCP across repos. Spec: `docs/specs/workspaces.md`.

### Added — Chat

- **Message queue.** Messages sent while a bot is busy wait above the composer and go out in order when its run ends cleanly. Edit, reorder, remove or **Send now** each one. The queue is kept in `runs/queue.json`; after a failed or stopped run, a usage limit or a restart it pauses with the reason until you **Resume**.
- **Steering.** ⌘/Ctrl Enter while a bot works writes the message into the running turn without stopping it (Claude, through the SDK's streaming input). It shows in the thread where the run took it; one the run never took goes back to the front of the queue. Other providers queue it first in line.
- **Usage limit, then resume at reset.** A rejected plan limit holds the bot's queue with the reset time; **Resume at reset** continues on its own ("Continue where you left off."), **Continue now** goes right away. Reset times are never guessed.
- **Approval bar** above the composer: one line per request, **Approve all / Deny all** when several wait. Security-gated requests are left to their cards.
- **Folded turns.** Each turn's narration and tool calls fold behind "Worked for 2m 10s"; the answer, errors and the done line stay visible. While running it reads "Working · 12s" or "Waiting for approval · 12s".
- **Readable tool groups**: "Read 3 files · Ran 2 commands", "Running npm test"; each call opens to its raw input and output.
- **Changed files per run** under the reply, with a diff per file. Tracked from the bot's own write tools (before/after snapshots, never `git status`); a file changed by something else between the run's edits is left out rather than misattributed. Shell commands' writes aren't listed.
- **`@` file mentions** in the composer.
- **Find in thread** (⌘/Ctrl F), painted with the CSS Custom Highlight API; folded turns open while you search.

### Added — Parallel builders

- **Parallel builders.** With two or more developer bots, ready tasks whose `files` don't overlap build side by side in the goal's folder, each committed with the files its own run wrote (shell writes go in one shared batch commit). The remaining budget is split between them. Tasks without `files` and multi-repo workspace goals still build one at a time.

### Added — Appearance

- **Settings → Appearance** (personal, this browser): accent colour (presets or taken from the wallpaper, in OKLCH with clamped chroma), built-in gradient wallpapers or your own image with frosted-glass panels, a **Time of day** wallpaper that changes at 06:00, 12:00 and 18:00, and text size. The look is painted before first render, so nothing flashes. Reduced-transparency settings keep panels solid.

### Fixed

- Projects that aren't a multi-repo workspace no longer crash the UI on load (`GET /api/workspace` returned `{ ok: true }` instead of `null`).

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

[Unreleased]: https://github.com/kinleyrabgay/agentroom/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/kinleyrabgay/agentroom/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/kinleyrabgay/agentroom/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/kinleyrabgay/agentroom/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/kinleyrabgay/agentroom/releases/tag/v0.0.1
