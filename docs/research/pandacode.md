# PandaCode teardown

Research notes on [aicodeking/pandacode](https://github.com/aicodeking/pandacode) (v0.3.28, Oct 2026): how it works, its UI ideas, and what is worth bringing into AgentRoom.

> **License.** PandaCode uses the MIT License plus one condition: any work *based on* PandaCode that is released publicly must say "This is a fork of PandaCode" and link to the repository. To avoid that condition, **port ideas, not code**. Everything below describes mechanisms in prose, and AgentRoom should reimplement them in its own stack (Node, Hono, Next.js, Claude Agent SDK). If a file is ever copied verbatim, the attribution requirement applies.

## 1. What PandaCode is

- A desktop app built on Tauri 2, with a Rust core, SQLite storage and a vanilla TypeScript renderer. It does not use React and does not run a Node server.
- It is a GUI over coding CLIs the user already has installed. It supplies no inference of its own. Supported CLIs:
  - Claude Code, along with the GLM and MiMo relays that run through it.
  - Codex, through `codex app-server`.
  - ACP agents: Kimi, OpenCode, Grok, DeepSeek, Copilot, Cline and others.
  - Pi, through its RPC mode.
  - Muse, through MSP.
- It is local-first: no accounts and no telemetry. Secrets are kept in the OS keychain.

**How it compares with AgentRoom.** PandaCode is *one person driving many harnesses in parallel*. AgentRoom is *a team of bots running a governed goal lifecycle*. The two overlap a lot: task board, worktrees, approvals, GitHub, in-app browser, bots, usage. PandaCode is ahead on **conversation ergonomics** and **runtime robustness**. AgentRoom is ahead on governance: the goal lifecycle, security gates, the context map and budgets.

## 2. Runtime: how it works

### 2.1 One protocol reducer per harness
- Every harness is a child process that speaks newline-delimited JSON over stdio.
- A single `Protocol` state machine handles every harness. Its interface is `receive(frame) → Step { events, writes, done, calls, failure }`, and it switches on the provider id.
- Because each step is a pure function from a frame to its outputs, tests can feed in **recorded real frames**. The codebase is full of such tests.
- Running a harness:
  - The child runs in its own process group; teardown sends a kill to the whole group.
  - One `select!` loop multiplexes user input, host-tool jobs (at most 8 at a time), a 90 s startup deadline and stdout.
  - Frames are capped at 4 MiB, and only the last 16 KiB of stderr is kept.
  - Stopping runs the provider's `cancel()` first, then waits 3 s, then closes stdin, sends SIGTERM and finally kills.
- Every run emits events with the same shape:
  - `status`, `session`, `message_start`, `text`
  - `tool {id, name, status, input≤4K, output≤8K, write_paths}`
  - `approval`, `approval_cancelled`, `input_request`
  - `usage {usedTokens, contextWindow}`, `limited {resetsAt}`
  - `steer {id, status}`, `subagent`, `turn_changes`, `done`, `error`

### 2.2 Message queue and steering
- **Queue.**
  - A durable SQLite table holds up to 50 entries per task.
  - `take` deletes the row as it returns it, so each entry is delivered at most once. `restore` puts an entry back at the head.
  - The queue is drained only after a clean run end.
  - A failed run, a stop, a restart or a usage limit sets a **hold** that has a reason. The hold is set even when the queue is empty, so a message added a moment later cannot slip through. **Resume** releases it.
- **Steering** (⌘Enter while a run is active):
  - Steering never stops the run.
  - Claude is started with `--replay-user-messages`. The steer is written into the stream immediately, and delivery is confirmed when the replay echoes it. If a `result` arrives before the echo, the process stays open so Claude answers the steer as its next turn.
  - Codex receives `turn/steer`.
  - Harnesses that cannot accept a steer mid-turn get it as the **next turn of the same process**.
  - The UI receives `pending`, `delivered` and `failed` statuses. A failed steer goes back into the queue.
- **Prompt input** is never disabled. Enter queues the message and ⌘Enter steers it.

### 2.3 Approvals
- Each task has one of four modes: `ask`, `auto`, `plan` or `full`. Each mode maps to the harness's native permission mode, so the UI never clicks approvals on the agent's behalf.
- Approval ids have the form `"<run_id>:<req_id>"`. Only a short summary crosses IPC; the full request stays in the native process. An answer from a stale run is rejected.
- `AskUserQuestion` is denied with the message "ask in plain text", because a yes/no approval must not silently submit a structured answer.

### 2.4 Warm process pre-spawn
- After a successful Claude turn, PandaCode starts the next turn's CLI process in the background, so the follow-up turn skips CLI startup.
- The spare process is given a **placeholder MCP server** that serves the last turn's tool catalog. When the next turn adopts the process, that server is *rebound* to the real turn's context at the same address.
- A spare is adopted only if a key matches exactly. The key is the serialized launch inputs: model, effort, mode, cwd, resume id, instructions and tool catalog. On a miss, the log records which fields differed.
- An **epoch counter** for each session discards a spare built for an earlier launch.
- At most 2 spares exist, and each expires after 10 minutes idle.

### 2.5 Turn changes (diffs for each turn)
- Diffs are **not** taken from `git status`.
- When a write tool starts, the paths it declares are captured with a SHA-256 snapshot of their content, and captured again when the tool finishes.
- If a file changed between two of the task's own tools, its attribution is *ambiguous* and the file is dropped rather than credited to the wrong tool.
- Agents also get a handshake tool, `track_files begin/complete`, for Bash writes whose paths are not declared.
- Captures are bounded: 200 files, 1 MiB per file, 32 MiB per turn, and a 500 ms scan budget.
- Patches are stored and cannot be changed. A global retention budget evicts patch bodies but keeps the summaries.

### 2.6 Architect and workers
- The lead dispatches assignments, and each assignment declares `files` scopes.
- A scheduler, driven by **revision counters** rather than polling, starts a queued worker when three conditions hold:
  - its dependencies are complete;
  - a parallel slot is free;
  - no other active writer overlaps its file scope. This check also covers other teams working in the same checkout.
- The app starts lead turns on its own, in this priority order: a worker failed, then a coordination message arrived, then all workers have settled and need review.
- Worker output reaches the lead as **untrusted data** within a 36 KiB budget, newest first, with unchanged workers reduced to one line.
- A watchdog stops a turn that has produced no output for 20 minutes. Time spent waiting for an approval does not count.

### 2.7 Usage and rate limits
- **Context meter.** Shows a snapshot of current context occupancy taken from each harness's usage frames.
- **Cost ledger.** Parses `~/.claude/projects` and Codex rollouts offline.
  - Parsing is incremental, cached by byte offset per file.
  - Entries are deduplicated by message id plus request id.
  - Prices come from the LiteLLM price list, fetched daily, with a bundled fallback.
  - One test machine scanned 7.9 GB in 6 s; a rescan took 10 ms.
- **Usage limit.**
  - A `limited {resetsAt}` event (never a guessed time) sets `limited_until` on the task.
  - A SQLite trigger clears that state whenever the user sends a message.
  - With "Resume at reset" on, a timer sends "Continue where you left off." at the reset time.

### 2.8 Other runtime features
- **Turn checks** (off by default). After a clean turn, the app runs `npm test` or `cargo check` with a 120 s limit. A failure queues **one** editable fix message and never loops.
- **Token saver.** Response-style packs (Caveman, Lean code, Quiet tools) are attached as a folded context block. The block is sent only when the packs change and on every 8th message, never on every turn.
- **App instructions.** For Claude-family harnesses these go in `--append-system-prompt`, where they are cached with the prompt prefix. Other harnesses get them on the first turn and every 8th turn after that.
- **Recipes.** JSON step lists (prompt, slash, check, approval). A dry run marks each step for the current harness as supported, fallback, manual or blocked. Running a recipe puts its steps in the ordinary queue.
- **Bots.** Each bot conversation is an ordinary task. Channels: Telegram, Slack, Discord, WhatsApp and a local web chat. A Guard applies rules in this order: deny rules, then an always-ask list, then allow rules. A sender who is not known yet must pair with a 4-digit code.
- **Remote access.**
  - The relay is a Cloudflare Worker with one Durable Object per account.
  - End-to-end encryption: X25519 key agreement, HKDF, then XChaCha20-Poly1305.
  - The user pins device fingerprints, and every request carries a timestamp and nonce for replay protection.
- **Design canvas.** Agents write HTML artboards to `.pandacode/design/`. The app renders each one in an `<iframe sandbox srcdoc>` with scripts disabled. A click on an element produces a CSS selector and stores it as a comment for the agent to read.

## 3. UI concepts

### Layout
- **Main grid.** Three columns: sidebar of 235 px, conversation of at least 420 px, inspector of 302 px.
- **Sidebar.** A tree of projects and their tasks. Each task row shows the harness logo, a relative time and an unread dot.
- **Header.** A segmented switch between Conversation, Board and GitHub.
- **Inspector.** A VS Code-style icon column that switches between Files, Search, Changes, Browser, PR, Simulator, VM and Design.
- **Composer context bar.** A strip above the prompt showing project, Local or Worktree, and the branch chip.
- **Quick launcher.** A global ⌘⇧Space window for starting a task and checking which agents are running.

### Conversation
- **"Worked for 2m 10s ›".** Each turn's narration and tool calls fold into a single disclosure. The final answer, errors and approvals stay outside it. While the turn runs, its label is live, for example "Waiting for approval · 12s".
- **Tool groups.** Up to 5 consecutive calls are shown as one sentence with a stack of icons ("Ran 2 searches · Read 3 files"). Each row opens to a readable preview, and the raw input and output sit in a quieter nested disclosure.
- **Streaming markdown.** The output is repainted at most every 32 ms. A reconcile step appends to text nodes and never replaces finished blocks, so text selection and layout stay stable.
- **Scroll anchoring.** The view follows the bottom only when it is within 140 px of it. Otherwise it stays anchored to the nearest message key and keeps fractional rounding remainders, so the view never jumps.
- **Find in thread (⌘F).** Matches are painted with the CSS Custom Highlight API, so the DOM is never changed. The current match opens any folded turn that contains it.
- **Thread switching.** An LRU cache of the last page of 24 threads, plus a markdown HTML cache keyed by source text, lets the app draw a thread in the same frame as the click.
- **Folded context.** Attached files, GitHub context, the bot brief and the token-saver text collapse into "📎 Attached context".
- **Teams.** An inline "Team complete" card has one row per worker. A pill at the top right lists subagents.

### Composer
- The model picker covers harness, model, context size and an effort slider. Recently used models are listed first.
- Slash commands come from **each harness's own command list**. The `/` menu only inserts text.
- `@` mentions open file search over a lazy index that respects `.gitignore`.
- **Queue panel** above the prompt:
  - Every row has Steer, Send now, Edit, reorder and delete.
  - Each hold shows its reason, for example "Paused after the run failed".
- **Approval bar** directly above the prompt:
  - One request is one line with Deny and Approve buttons.
  - Several requests collapse into "3 approvals needed" with **Approve all**.
- **Usage-limit banner:** "Resets 3:00 PM · Resume at reset · Continue now".

### Design system
- One accent color derived in **OKLCH** from any source: a wallpaper, a swatch or an imported VS Code theme.
  - Chroma is clamped to 0.09–0.19 and lightness to at least 0.68 in dark mode.
  - Dim, ink, focus and tint shades are derived from it.
  - The derived colors are cached before first paint, so the accent never flashes.
  - Styles always use `rgb(var(--accent-rgb)/a)` or `color-mix`, never a literal color. The heatmap levels and find highlights follow the accent too.
- **Glass material.** One set of tokens covers dialogs, menus and toasts. The `<dialog>` element itself stays transparent and untransformed; a sibling "plate" carries the blur and the accent glow at the top edge. This keeps `position:fixed` menus inside the dialog correctly positioned.
- **Instant UI.**
  - `transition: none !important` applies everywhere. Only looping status animations remain (spinners and a breathe pulse).
  - Press feedback uses the CSS `scale` property, not `transform`.
- **Density.**
  - Every row is one line. A detail longer than about 48 characters moves behind an ⓘ tooltip, and its text stays in the DOM as `.sr-only`.
  - Every count uses `tabular-nums`.
  - Segmented controls use a single "thumb" element sized from `offsetLeft` and `offsetWidth`.
- **Generative UI.** Agents can emit fenced ```` ```ui ```` JSON (stats, table, chart, steps, compare, checklist, form…).
  - It renders in a shadow root with hard limits: 64 KB, depth 4, 120 nodes.
  - Buttons only **fill the composer**; they never run anything.
- **Usage page.**
  - A GitHub-style heatmap whose colors come from the accent.
  - A daily cost chart stacked by provider.
  - Limit meters that always read "% used".

## 4. Gap analysis against AgentRoom

| PandaCode feature | AgentRoom today | Verdict |
|---|---|---|
| Durable queue, steering and hold reasons | Composer can send, but `Provider.run()` is one-shot, with no steer input or hold states | **P0** |
| Approval bar with Approve all | `approval-card.tsx` and `pending-actions.tsx` exist | **P1**: compact bar plus "Approve all" |
| "Worked for…" folded turns and sentence tool rows | `tool-group.tsx` shows "Used N tools" with a raw name and summary | **P1** |
| Streaming reconcile and scroll anchoring | Unverified | **P1**: measure first |
| Find in thread (Highlight API) | None found | **P1**, cheap |
| Per-turn diffs from declared write paths | Diffs per goal and per task commit | **P2**: per-turn view inside chats |
| Usage limit, then resume at reset | Account usage exists (`account-usage.ts`); no limit or resume flow found | **P1** |
| Turn checks (one fix message, no loop) | Goal runner has QA and proof | **P2**: for plain chats |
| Token saver packs | None | **P2** |
| `@` file mentions | None found | **P1** |
| Slash commands from the harness's own list | `/` lists skills | **P2**: extend |
| Warm Claude pre-spawn | None | **P3**: Agent SDK `query()` start-up cost should be measured first |
| Scope-aware worker scheduler (no overlapping writers) | Goal runner is sequential, using tasks with `files` and `dependsOn` | **P2**: allows parallel dev tasks |
| Recipes (dry-run capability check) | Goal templates | **P3** |
| Generative UI DSL | None | **P3**: fits Insights and reports |
| OKLCH accent, glass and density rules | shadcn/Tailwind theme | **P3**: a polish pass |
| Usage heatmap and stacked cost chart | Usage and insights pages exist | **P2** |
| Bots on channels, remote relay, VMs, simulators, design canvas | Remote approvals use `cloudflared`; Slack/Teams digests | Out of scope for now |

## 5. Suggested port order

1. **Queue and steering.**
   - Add a `queued_messages`-style store per bot session.
   - Add a hold that carries a reason: `failed | stopped | limited | restart`.
   - With the Claude Agent SDK, steering maps to streaming-input mode (an async iterable prompt): push the user message into the live `query()` and do not start a new run.
   - UI: a queue panel above the composer, Enter to queue and ⌘Enter to steer.
2. **Conversation pass.**
   - "Worked for…" folding, with the final answer kept outside it.
   - A `KINDS` verb table ("Read 3 files", "Ran 2 commands").
   - A raw input/output disclosure.
   - ⌘F with `CSS.highlights`.
   - Scroll anchoring with a 140 px follow threshold.
3. **Approval bar.** One line above the composer, Approve all and Deny all, and approval ids scoped to the run.
4. **Usage limit → resume at reset.** Use the SDK's rate-limit events; never guess a reset time. Clear the limit when the user sends a message.
5. **`@` mentions.** A lazy index of the workspace (or worktree) that respects `.gitignore`, built with the bounds listed in §2.8 above.
6. **Per-turn changes in chats.** Capture the paths each tool declares, with before and after hashes, and drop ambiguous files.
7. **Parallel builders.** Run `dev` tasks in parallel when their `files` scopes do not overlap.

Each item should get its own spec in `docs/specs/` before implementation.

## 6. What shipped in 0.0.4

Items 1–7 of §5 are built (reimplemented, no PandaCode code copied):

| Item | Where |
|---|---|
| Queue, holds and steering | `src/server/agents/bot-queue.ts`, `Team.submit/steer` in `team.ts`, the input channel in `providers/claude/`, `web/features/chat/components/queue-panel.tsx` |
| Approval bar | `web/features/chat/components/approval-bar.tsx` |
| Folded turns, tool sentences, raw I/O, ⌘F | `web/features/chat/lib/transcript.ts` (`foldTurns`), `lib/tool-kinds.ts`, `components/activity-fold.tsx`, `components/thread-find.tsx` |
| Usage limit → resume at reset | holds in `Team.afterRun`, `scheduleResume` |
| `@` mentions | `web/features/chat/lib/file-suggestions.ts` over `GET /api/files` |
| Changes per run | `src/server/agents/turn-changes.ts`, `components/turn-changes-card.tsx` |
| Parallel builders | `src/server/workflow/scopes.ts`, `GoalRunner.buildBatch` |
| Appearance (OKLCH accent, wallpapers, glass, text size) | `web/features/appearance/` |

Still open from §4: token-saver packs, warm Claude pre-spawn, recipes, generative UI, usage heatmap. Steering against the real Claude CLI has not been checked in a live run yet.
