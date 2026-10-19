---
name: planning
description: Break a goal into small, verifiable steps. Use when scoping work, writing an implementation plan, or splitting a goal into tasks.
---
# Planning a goal into board tasks

**Investigate before planning.** Read the entry points, the code that must change, reusable helpers, existing tests and the project's build/test commands. Plans built on guesses fail in review.

**Overview (`plan_overview`)** — 5–15 lines: approach, affected areas (paths), risks and unknowns, how it will be verified.

**Dev tasks** — one coherent change each, about 1–2 hours of work:
- Title: imperative, specific ("Add divide() with zero guard to src/math.ts").
- Description (markdown): what and why, approach, edge cases, out of scope.
- `files`: paths expected to change.
- `acceptance`: 2–5 testable statements. Good: "`GET /api/users?page=2` returns 20 items and a `next` cursor". Bad: "pagination works".
- Tests belong in the same task as the code they cover.
- `dependsOn` only for real ordering constraints; set `order` 1..n.

**QA tasks** — usually 1–3, after the dev tasks:
- Which suites/commands to run; which user flows to click through in the browser for UI work.
- Acceptance criteria mapped to the dev tasks' criteria.

**Never** implement, run builds or commit while planning. If a decision belongs to the human, `ask_human`.
