# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-19

Initial release.

### Added

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

[Unreleased]: https://github.com/kinleyrabgay/agentroom/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kinleyrabgay/agentroom/releases/tag/v0.1.0
