# AgentRoom platform plan

> Your AI engineering team, from issue to merged PR, proven working, while you sleep.

This plan builds on what shipped up to 0.0.3: bots and skills, the goal runner, worktrees and PRs, security gates, budgets, automation, phone approvals, Sentry, GitHub, MCP and the repo context map. It is organised in five pillars and seven milestones. Every feature has the same sections: **Why**, **UX**, **How**, **Data**, **Safety**, **Done when**, **Size** (S ≈ days, M ≈ 1–2 weeks, L ≈ 3+ weeks).

## Principles (unchanged, extended)

1. **Local first.** Everything works on one laptop with no account. Cloud features are opt-in and paid.
2. **Nothing leaves without a logged action.** GitHub, Slack, Linear, email, public URLs: every write is either clicked by a human or allowed by a visible, audited rule.
3. **Shared vs yours.** Team config in `.agentroom/` (committed); personal state, secrets and caches in `runs/`.
4. **Proof over promises.** A bot's "done" carries evidence: tests, screenshots, recordings, citations.
5. **Every gate shows why.** Finding, rule, risk score, cost.
6. **Provider-neutral core.** Claude first, but goals, tools, approvals and the ledger don't depend on one vendor.

## Milestones

| Version | Theme | Ships | Why this order |
|---|---|---|---|
| **0.1** | Proof | Proof of work in PRs, quality gates | Best demo, builds trust, reuses browser + worktrees |
| **0.2** | Intake | Slack/Teams bot, Linear + Jira, PR review from a link | Work arrives where teams already talk |
| **0.3** | Packs | Team packs, skill registry (install + publish), Agensi/skills.sh import | Distribution channel; answers the marketplace interest |
| **0.4** | Knowledge | Ask the codebase, generated docs, onboarding tour, multi-repo rooms | Context map becomes useful to humans too |
| **0.5** | Autopilot | Sentry incident autopilot, Figma → UI | Combines proof + intake + knowledge end to end |
| **0.6** | Engine | Multi-provider + model routing, learning loop | Cost and quality at scale |
| **1.0** | Cloud | Cloud runner, shared team room, billing | Revenue; needs everything above to be stable |

Each milestone ends with: docs, CHANGELOG, a demo GIF in the README, `npm run check`, and a live smoke test on a real repo.

---

## Pillar A: Intake (work arrives without you)

### A1. Slack / Teams bot

**Why.** The team already talks in Slack. Asking there, and getting the plan and PR back in the thread, makes AgentRoom part of daily work.

**UX.**
- `@agentroom fix WEB-4X` / `@agentroom add CSV export to reports` / `/agentroom status`.
- The bot replies in the thread: "Planning G-12…", then the plan summary with **Approve plan · Change · Cancel** buttons, progress lines per phase, and finally the PR link + proof GIF.
- Approval requests (risky commands, publish gates) arrive as interactive messages; who clicked is recorded in the audit log.
- Settings → Integrations → Slack: connect, pick channels, map Slack users to git identities, choose who may start goals and who may approve.

**How.**
- Slack app in **Socket Mode** (websocket out from the laptop, so no public URL or tunnel is needed). Manifest shipped in `templates/slack-app.json`; the user creates the app in one click from the manifest and pastes the app-level + bot tokens.
- Teams: Bot Framework requires a public endpoint, so Teams uses the existing cloudflared tunnel (like phone approvals) or, later, the cloud relay.
- New `src/server/integrations/slack/` (client, socket, message renderer using Block Kit) and an `IntakeService` that turns a message into a goal or chat using the same path as the composer (templates, natural-language schedule parsing included).
- Outbound updates subscribe to the existing realtime events (goal phase, approval requested, PR opened) and are throttled per thread.

**Data.** `.agentroom/integrations/slack.json` (committed: channels, permissions); tokens in `runs/secrets.json`; thread ↔ goal map in `runs/slack-threads.json`.

**Safety.** Allow-list of Slack users who may start goals or approve. Message text is untrusted input: wrapped with the prompt-injection guard. Approve buttons only work for mapped users with approver role. Daily budget applies; Slack-started goals stop after the plan unless the channel opts in.

**Done when.** A mention in a test workspace starts a goal, the plan is approved from Slack, the PR link and proof arrive in the thread, and every action is in the audit log with the Slack user.

**Size.** M (Slack), S–M (Teams via tunnel).

### A2. Linear and Jira

**Why.** Many teams track work there, not GitHub Projects.

**UX.** A **Sources** sidebar item per connected tracker, same layout as the GitHub page: columns/filters, cards, **Hand to bot** (Now / Later), status sync back ("In progress" when a goal starts, "In review" when the PR opens, comment with the PR link).

**How.**
- Generalise the GitHub board into an `IssueSource` interface: `list(filter)`, `get(id)`, `transition(id, state)`, `comment(id, body)`, `link(id, prUrl)`. GitHub, Sentry, Linear and Jira implement it; triggers ("when a card moves to Ready") work for all of them.
- Linear: GraphQL API with a personal API key (or the Linear MCP). Jira: REST v3 with an API token. Polling every 5 minutes like the GitHub trigger; webhooks later via the cloud relay.

**Data.** `.agentroom/integrations/linear.json` / `jira.json` (committed: team/project, column mapping); keys in secrets; cache in `runs/`.

**Safety.** Writes (status, comments) only from explicit hand-offs or a rule the user enabled, all audited. Issue text is untrusted.

**Done when.** A Linear issue is handed to a bot, moves to In Progress, gets the PR link, and a "moved to Ready" trigger works.

**Size.** M (interface + Linear), S (Jira on top).

### A3. PR review from a link

**Why.** Already on the roadmap. Teammates' PRs get a careful first review.

**UX.** Paste a PR URL (or ⌘K "Review PR…"). The Reviewer bot checks out the PR in a worktree, runs tests, uses the context map for impact, and drafts comments. You see them inline in the existing Changes viewer: edit, drop or **Post review** (comment / request changes / approve). Optional trigger: "when a PR is opened with label `agentroom-review`".

**How.** `gh pr checkout` into a worktree; diff via `gh pr diff`; posting via `gh api repos/:o/:r/pulls/:n/reviews` with line comments. Reuses the diff viewer and the security scanner on the PR diff.

**Safety.** Nothing posts until **Post review** is clicked. Read-only mode for forks (no scripts from untrusted PRs run without approval; tests run only after you allow it).

**Done when.** A real PR gets a drafted review with line comments that posts correctly after approval.

**Size.** M.

### A4. Figma → UI

**Why.** "Build this screen" from a design link is a frequent, high-value request.

**UX.** Paste a Figma frame link in the goal box or attach it in New goal → template **Implement design**. The plan shows the frame thumbnail. The proof step shows design vs implementation side by side with a match score.

**How.** Figma MCP (official) for frame data and assets; the Developer bot implements; the proof step (B1) screenshots the running page at the frame's size and computes a pixel/structure diff.

**Done when.** A simple frame becomes a component with a visual match report in the PR.

**Size.** M (after B1).

---

## Pillar B: Proof (trust the output)

### B1. Proof of work in PRs

**Why.** "It works" is a claim; a recording and passing tests are evidence. This is the single strongest demo.

**UX.**
- New goal phase **Verify** between Test and Report: the bot writes a short scenario ("open /reports, click Export, file downloads"), runs it in a real browser, records it.
- Goal page → **Proof** tab: GIF/MP4 of the scenario, before/after screenshots per page touched, tests added and their results, coverage change, Lighthouse/a11y scores (B2).
- PR body gets a **Proof** section with the GIF, screenshots and the test table.
- The human can re-run proof or edit the scenario.

**How.**
- Headless browser via `playwright-core` as an optional dependency, using the system Chrome (`channel: 'chrome'`), so the package stays small. `agentroom doctor` reports whether proof is available.
- The dev server comes from the existing preview service (it already knows how to start and proxy the app). Scenario steps reuse the `browser_*` tool vocabulary so bots already know it; recording = screenshots per step stitched into a GIF (pure-JS encoder) plus Playwright video when available.
- "Before" screenshots: run the same scenario on the base branch's worktree.
- Images in the PR: pushed to an orphan branch `agentroom/proof` under `G-n/` and linked by URL (works for private repos for anyone with access). Optional: keep them local only.

**Data.** `runs/proof/<G-n>/` (frames, gif, report.json). Settings: `proof.enabled`, `proof.publish: "branch" | "local"`, max recording length.

**Safety.** Scenario runs only against the local preview; no external URLs unless allowed. Secrets are masked in screenshots via a selector list (`proof.mask: ["[type=password]", ".api-key"]`).

**Done when.** A UI goal on a Next.js app produces a PR with a working GIF, before/after shots and the test table, end to end without manual steps.

**Size.** L.

### B2. Quality gates

**Why.** Catch regressions the tests don't.

**UX.** Settings → Quality: toggle checks and thresholds. Results show in Proof and gate publishing like security findings do ("Accessibility dropped 12 points: approve anyway?").

**How.**
- Coverage diff: run the project's coverage command (detected or configured) on base and head.
- Lighthouse + axe-core in the same headless browser as B1.
- Bundle size: compare build output sizes for known frameworks.
- Visual regression: pixel diff of B1 screenshots against the base branch.
- All results feed the existing risk score.

**Done when.** A change that drops a11y score below the threshold is blocked with a clear reason and an override.

**Size.** M.

### B3. Sentry incident autopilot

**Why.** The most valuable automation: production error → reviewed fix, fast.

**UX.** Trigger "When a new fatal issue appears or an issue spikes ×N" → **Autopilot**: reproduce → failing test → fix → proof → PR. The Sentry issue page shows each step with a **confidence score** (reproduced? test fails before and passes after? blast radius from context impact?). Low confidence stops for a human.

**How.** Combines existing pieces: Sentry trace + context `impact` to find the code, B1 browser for UI reproductions, a "reproduce first" goal template, risk score + confidence → auto-PR only above the threshold, PR body links the Sentry issue ("Fixes WEB-4X").

**Done when.** A seeded bug in a demo app goes from Sentry event to PR with a failing-then-passing test, unattended, and stops correctly when it can't reproduce.

**Size.** M (after B1).

---

## Pillar C: Knowledge (the codebase explains itself)

### C1. Ask the codebase

**Why.** The context map is valuable for humans too: onboarding, "where is X handled?", "what breaks if I change Y?".

**UX.** Context page → **Ask** box (and ⌘K "Ask the codebase…"). Answers cite `file:line` chips that open the code peek. "Turn into goal" button when the answer suggests a change.

**How.** A read-only bot with only the `context_*` tools, Read and Grep, a cheap model by default; answers must cite or say "not sure". Questions and answers saved per user in `runs/`; good answers can be pinned into a module's notes.

**Done when.** Ten onboarding questions on this repo get cited, correct answers under 5¢ each.

**Size.** S.

### C2. Generated docs

**Why.** Architecture docs are always out of date; the map isn't.

**UX.** Context → **Docs**: generate `docs/architecture.md` (module overview, dependency diagram in Mermaid, key flows) and decision records from the decision log. Shown as a diff; you commit it.

**How.** Templated from the graph and cards; Mermaid generated from module edges; regeneration only rewrites sections whose modules changed.

**Size.** S.

### C3. Onboarding tour

**Why.** New teammates get a guided walk through the system.

**UX.** Context → **Tour**: an ordered path through the modules (entry points first, then core, then features) with each card, key files and a "try it" question. Progress saved per person.

**How.** Order from graph depth and fan-in; text from cards; optional short quiz from the card's invariants.

**Size.** S.

### C4. Multi-repo rooms

**Why.** Frontend and backend usually live in separate repos; one goal often spans both.

**UX.** A room with several repos: one team, one board, one context map with repo frames, goals that produce linked PRs in each repo ("part 1 of 2").

**How.** `~/.agentroom/rooms/<name>.json` lists repo paths; each repo keeps its own `.agentroom/`; the server mounts several projects; context graphs merge with cross-repo edges from API contracts (OpenAPI / tRPC / GraphQL schemas, shared package names). Worktrees per repo per goal.

**Safety.** Approvals and budgets apply per room; PRs are opened together but each needs its own approval.

**Size.** L.

---

## Pillar D: Team (multiplayer and distribution)

### D1. Team packs

**Why.** Starting from a good team for your stack beats starting from defaults.

**UX.** `agentroom init --pack nextjs-saas` and Settings → **Packs**: browse, preview (bots, skills, templates, settings, sample goals), install, update. Packs: Next.js SaaS, Flutter app, Python API, Go service, Data/ETL, Docs site.

**How.** A pack is a folder (or git repo/tarball) with `pack.json` (name, version, stack detection rules, contents) + `bots/`, `skills/`, `goal-templates/`, `settings.partial.json`. Install merges without overwriting your edits (three-way merge using the installed version as base, stored in `runs/packs.lock.json`). Auto-suggest a pack from detected stack on `init`.

**Done when.** Two packs ship in the repo, install cleanly, and update without clobbering local edits.

**Size.** M.

### D2. Skill registry (install and publish)

**Why.** Skills are the reusable unit; sharing them is distribution. Also answers marketplaces like Agensi.

**UX.** Skills library → **Browse**: search registries (AgentRoom index, skills.sh, a company's private index), see description/version/installs, **Install** to the project or to your user library. **Publish** a skill: validates `SKILL.md`, packs it, and opens the registry's publish flow (or a PR to the AgentRoom index repo).

**How.** Registry = JSON index over HTTPS (`index.json` + tarball URLs + sha256). Install verifies hash, shows the full skill text before install, records origin and version in frontmatter (`source:`), and supports updates. A private registry is just a URL in settings.

**Safety.** Skills are instructions bots follow, so installation always shows the complete text and any scripts; scripts never run on install; injection scanner runs on the skill text; origin shown on the skill chip.

**Done when.** Install from the AgentRoom index and skills.sh works with hash checks; publish produces a valid package.

**Size.** M.

### D3. Shared team room (multiplayer)

**Why.** Teams want to see each other's goals, approve each other's work, and hand off.

**UX.** Presence avatars in the top bar; goals show their owner; any reviewer can approve; "Assign to Dorji's bots"; comments on goals and plans; notifications per person.

**How.**
- Local network first: the server can accept teammates on the LAN with per-person tokens (opt-in, explicit bind).
- Remote: the cloud relay (E3) forwards websocket traffic end-to-end; machines stay the executors.
- Identity = git email + a signed token; roles: owner, approver, viewer.

**Safety.** Approvals carry the approver's identity in the audit log; viewers can't approve; the owner's machine executes only its own goals unless delegated.

**Size.** L.

---

## Pillar E: Engine (smarter, cheaper, always on)

### E1. Multi-provider and model routing

**Why.** Cost and resilience; some teams standardise on other vendors.

**UX.** Settings → Models: provider per phase (plan: cheap, build: strong, review: different model for a second opinion), fallbacks on rate-limit or outage, cost preview per goal.

**How.**
- The `Provider` interface already exists (`src/server/providers`). Add adapters: Codex SDK, Gemini CLI, any OpenAI-compatible endpoint (local models).
- AgentRoom host tools are already MCP, so they work across providers. Approvals: Claude uses `canUseTool`; other providers run in their own sandbox/approval mode and AgentRoom wraps shell and write tools it can intercept; the UI shows which guarantees each provider gives.
- Ledger already records model and cost per run; routing rules use it.

**Done when.** One goal can plan on Haiku, build on Opus and review on another vendor, with correct costs in the ledger.

**Size.** L.

### E2. Learning loop

**Why.** The team should get better over time, measurably.

**UX.** Insights → **Experiments**: "Skill testing-v2 vs testing-v1: success 82% vs 71% over 40 goals". Suggestions: "Planner fails often on migrations; add the db-migrations skill?" with one-click apply. Replay-based eval: rerun past goals against a new prompt in a sandbox and compare.

**How.** Ledger has skills used, ok/failed and costs; add outcome labels (PR merged, reverted, review rounds). A/B assignment per goal; simple statistics with minimum sample sizes; eval runs in throwaway worktrees with a budget cap.

**Size.** M.

### E3. Cloud runner and relay

**Why.** Schedules and triggers when the laptop is closed; shared rooms over the internet; the paid tier.

**UX.** Settings → Runner: **This Mac** / **AgentRoom Cloud**. Schedules and triggers already have a `runner` field. Cloud status in the top bar; same UI, connected remotely.

**How.**
- Per-project sandbox container (Firecracker/gVisor-class isolation) that clones the repo, runs the same AgentRoom server headless, and talks to the UI via the relay.
- Model access with the customer's own API key (stored encrypted, per project), never a personal subscription login.
- GitHub App for clone/push instead of personal tokens; per-project secret vault.
- The relay: authenticated websocket broker; phone approvals and Slack also route through it, replacing the tunnel.

**Safety.** No customer code leaves the container except as PRs; audit log mirrored; spend caps enforced server-side; SOC 2-style controls before team launch.

**Size.** L+ (separate service; plan its own repo).

---

## Cross-cutting changes

**Sidebar (information architecture).**
- Workspace: Team · Inbox · Work · Context · Automation
- Sources: GitHub · Linear · Jira · Sentry · Slack (when connected)
- Quality: Security · Proof · Audit log · Insights
- Library: Skills · Packs
- Footer: Settings · connection · theme

**Goal phases.** Plan → Review → Build → Security → Test → **Verify** → Report.

**Settings sections added.** Integrations (Slack, Linear, Jira), Quality, Proof, Models (routing), Packs, Registry, Runner (cloud).

**Security model updates.**
- Every new inbound source (Slack, Linear, Jira, Figma, registry skills) is untrusted text through the injection guard.
- Per-source permission rules (who may start, who may approve), all audited with the external identity.
- Outbound writes to new services follow the same rule: clicked or explicitly allowed.

**Metrics to judge success.**

| Metric | Target by 1.0 |
|---|---|
| Goals that end in a merged PR | > 60% |
| PRs with proof attached | > 80% of UI goals |
| Median human minutes per goal | < 5 |
| Exploration tokens per task (context map) | −50% vs 0.0.2 |
| Reverted bot PRs | < 5% |

## Business model

- **Free, open source (MIT):** everything that runs locally, including all pillars except the cloud parts.
- **Pro (per seat):** cloud runner, relay for Slack/phone without a tunnel, shared rooms over the internet.
- **Team / Enterprise:** private registry and packs, SSO, audit export, spend controls across projects, support.
- **Marketplace:** free skills and packs listed (AgentRoom index, skills.sh, Agensi) as a funnel back to AgentRoom.

## Open questions

1. Slack first or Teams first? (Plan assumes Slack, Socket Mode.)
2. Proof images in an orphan branch, or local only by default?
3. Linear before Jira? (Plan assumes Linear.)
4. Which two team packs first? (Plan assumes Next.js SaaS and Flutter.)
5. Cloud: build the runner ourselves, or start on an existing sandbox provider to ship faster?
