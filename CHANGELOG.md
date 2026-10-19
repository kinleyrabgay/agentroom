# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/kinleyrabgay/agentroom/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/kinleyrabgay/agentroom/releases/tag/v0.0.1
