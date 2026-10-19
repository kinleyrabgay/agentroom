# AgentRoom roadmap: trust, control and daily use

Goal: people can comfortably let their bots work unattended. Security comes first.

## Where things live (information architecture)

Sidebar:

- **Workspace:** Team · Board (GitHub) · Tasks (goals) · Browser
- **Automation:** Reviews (PR review from a link) · Schedules
- **Governance:** Security · Audit log · Insights
- **Footer:** Settings (gear) · connection · theme

Top bar: page title · approvals waiting · **budget + usage pill** (today's spend against the cap) · inbox bell · Stop all.

Goal page (Tasks → a goal):

- Header: title · phase stepper (Plan → Review → Build → **Security** → Test → Report) · **risk badge** ·
  **budget meter** · worktree branch · actions.
- Tabs:
  - **Tasks:** the board.
  - **Changes:** a PR-style diff with inline comments, Revert task, and Open PR.
  - **Security:** scanner findings, dependency guard, and the security review.
  - **Timeline:** replay.
  - **Report.**

Bot panel tabs: Chat · Activity · Skills · **Memory** · Browser · Config.

Task sheet: adds **Screenshots** (before/after) and **Checkpoint** (commit, diff, revert).

New goal dialog: **template picker** (Bug fix, New endpoint, Refactor, Dependency upgrade), with a form
for each template's fields, an optional budget, and "Security review: auto / always / off".

Settings page sections:

- General (model per phase)
- Budgets
- Security (scanner rules, gates)
- Alerts
- Integrations (GitHub; Slack/Teams/email digests)
- Remote approvals (phone)
- Schedules defaults
- Data (audit retention)

## Phases

### P0: Foundation

- Every event that happens inside a goal carries `goalId`.
- **Run ledger** (`runs/ledger.jsonl`): one row per bot run with goal, bot, model, cost, tokens,
  duration, ok, skills used, and tool counts. Budgets, insights and replay are built on it.
- **Audit log** (`runs/audit.jsonl`, append-only, searchable). It records every shell command, file
  write, push, PR, GitHub write and approval, with who decided it (git user, "auto" by policy,
  "session rule", or "remote"), plus the goal, bot and time.
- **Settings store:**
  - `.agentroom/settings.json` (committed, team-wide): budgets, model per phase, security policy,
    schedules defaults.
  - `runs/secrets.json` (local, never committed): webhook URLs, SMTP, tunnel.
- New sidebar groups, the Settings page shell, and the Audit log page.

### P1: Security

1. **Secret and risk scanner** runs on every diff (each task checkpoint, and before any
   `git commit`, `git push` or `gh pr create`).
   - It looks for API keys and tokens, private keys, `.env` contents, hardcoded credentials,
     `eval`/`new Function`/shell injection, SQL string building, disabled TLS or auth checks, and
     wide-open CORS.
   - Findings are **critical** (red, blocks until approved) or **warning** (amber, needs
     acknowledgement). They appear as cards in Security and inline in Changes.
2. **Dependency guard** runs when a manifest or lockfile changes.
   - It runs `npm audit --json` and queries OSV (`api.osv.dev`) for new or changed packages.
   - It also checks for typosquats (edit distance against popular packages) and packages with
     install scripts.
3. **Security step** in the workflow: Build → Security review (the Security Auditor bot with a
   `security-review` skill) → Test.
   - It's optional per goal (auto / always / off).
   - It's always on when the diff touches auth, payment or migration paths.
4. **Risk score** per goal, 0–100 (low, medium or high), based on files touched, sensitive paths, diff
   size, scanner findings and dependency changes.
   - Medium turns on the security step.
   - High adds approval gates before Test and before the PR.
5. **Prompt-injection guard:**
   - Content from web pages, GitHub bodies and comments, and fetched URLs is wrapped as untrusted
     data in the bot's context.
   - Anything inside it that reads like an instruction is flagged in the tool result, the Security
     page and the inbox.

### P2: Diff review, PRs and isolation

1. **Worktree per goal:** `git worktree add runs/worktrees/<G-n> -b agentroom/<g-n>`.
   - The main `node_modules` is symlinked in, and bots run there, never in the user's working copy.
   - Goals can run in parallel.
2. **Checkpoints:**
   - The engine commits each finished task, so one change = one commit, and records it on the task.
   - "Revert this task" runs `git revert` in the worktree.
3. **Diff review (Changes tab):**
   - File tree, unified and split views.
   - Inline comments → "Request changes" sends them to the Developer as a fix round.
   - **Open PR** pushes the branch (an approval gate) and runs `gh pr create`. The body is Team
     Lead's report, plus "Closes #n" for GitHub card sources and the security summary.
4. **Finish:** merge back locally or remove the worktree after the PR.

### P3: Budgets, replay, templates, memory

1. **Budget caps:**
   - A per-goal and per-day spend limit, with a warning at 80% (inbox and alert).
   - At 100% the goal pauses; each run's SDK `maxBudgetUsd` is set to the remaining budget.
2. **Model per phase:** for example Opus for planning, Sonnet for build, Haiku for QA and the report.
   Configurable in Settings and overridable per goal.
3. **Replay and timeline:** a scrubber over a goal's ledger and events, with one lane per bot (tool
   calls, messages, approvals, checkpoints and their diffs), running cost, and playback.
4. **Goal templates:** `.agentroom/goal-templates/*.md` (committed, editable), each with form fields
   and planner guidance.
5. **Bot memory:**
   - `bots/<dir>/memory.md` (committed) is added to the bot's context.
   - Bots can append learned conventions with a `memory_note` tool.
   - Users edit it in the Memory tab.

### P4: Automation and insights

1. **Schedules:** `.agentroom/schedules.json` (committed). Cron jobs that send a prompt to a bot or
   start a goal from a template (presets: nightly e2e in the in-app browser, weekly dependency check).
   Run history is kept, and failures raise an alert. Jobs only run while AgentRoom is running.
2. **Visual QA:**
   - A `browser_screenshot` tool renders the page via `html-to-image`, served by the preview proxy.
   - Screenshots are saved under `runs/screenshots/` and attached to tasks as before/after. "Before"
     is captured at plan approval from the goal's preview URL; "after" during QA.
   - A slider compares them.
3. **PR review from a link:**
   - Paste a PR URL; Reviewer drafts structured comments.
   - You edit or approve each one; nothing is posted until you click **Post review**
     (`gh api …/reviews`).
4. **Digests:** Slack or Teams incoming webhooks, and email over SMTP. Sent when a goal is done or
   failed, plus an optional daily summary at a set time. Example: "G-4 done · 3 tasks · $0.41 ·
   PR #812 ready".
5. **Approve from your phone:**
   - Opt-in quick tunnel (`cloudflared`) that serves only a mobile approvals page.
   - Uses a separate, revocable token and a QR code, and expires automatically (default 8 h).
   - Only these endpoints are reachable: plan approval, permission approval, answering questions.
6. **Insights:** success rate per bot, cost per goal and over time, common failure reasons, how often
   each skill is used and how it relates to success, and approval latency.

## Principles

- Nothing is written to GitHub, Slack, email or a public URL without an explicit, logged action.
- Committed configuration (`.agentroom/*`) is separate from personal or secret data (`runs/`,
  never committed).
- Every gate shows *why*: the finding, the rule, the risk score.
