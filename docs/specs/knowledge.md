# Knowledge: Ask the codebase, generated docs, onboarding tour (0.4 C1–C3)

Built on the repo context map (`src/core/context`, `src/server/context`, `web/features/context`). Multi-repo rooms (C4) are not part of this.

## Where it lives

The Context page has four tabs in the top bar: **Map · Ask · Tour · Docs**. Routes:
`#/context/<module>` (map), `#/context/ask|tour|docs[/<module>]`, and `#/context/map/<module>` for a module whose id is a tab name.

| Piece | Files |
|---|---|
| Pure logic | `src/core/context/answer.ts` (citations, unsure check, grep/read over indexed files, prompt, tidy-up), `docs.ts` (sections, merge with markers, line diff), `tour.ts` (step order) |
| Server | `src/server/context/knowledge.service.ts` (`KnowledgeService`, `ClaudeAnswerer`); owned by `ContextService.knowledge`, so `server/index.ts` is unchanged |
| Routes | added to `src/server/http/routes/context.routes.ts` |
| Types | appended to `src/shared/types/context.ts` |
| UI | `web/features/context/components/{ask-page,tour-page,docs-page}.tsx`, `lib/ask-store.ts`; tab state in `context-store.ts` |
| Tests | `test/context-knowledge.test.ts` (15) |

## C1. Ask the codebase

- **Bot:** Claude Agent SDK `query()` with **no built-in tools** (`tools: []`), one in-process MCP server (`agentroom-ask`) holding the five `context_*` tools plus `code_grep` and `code_read`, `allowedTools` set to exactly those, `canUseTool` denying anything else, `settingSources: []`, no session saved, thinking off, `maxTurns` 16, `maxBudgetUsd` min(0.30, what's left today).
- **Why custom grep/read instead of Read/Grep:** Claude Code allows `Read` inside the cwd without asking, so a gate can't stop it reading `.env`. `code_grep` / `code_read` only touch files in the fact graph, which already excludes secrets, ignored files and `.agentroom/runs`.
- **Prompt:** INDEX.md first (cached prefix), then rules: cite `path:LINE` in backticks, cards are a map and the code wins, say "Not sure:" instead of guessing, short Markdown.
- **After the answer:** Markdown links are turned into plain citations, chatty openers ("Perfect! Now I have…") are dropped, every `path:line`, `path:a-b` and `path#symbol` is checked against the graph (shortened paths resolve when unique), modules are ranked by citations. `unsure` = hedged or no citation that checks out.
- **Cost:** a ledger row with `botId: "context"` (shows as "Repo context" on Insights, counts against the daily cap). Model = `settings.context.cardModel` (Haiku by default).
- **History:** `.agentroom/runs/context/asks.json`, newest 100, filtered to the asking git user.
- **Pin to notes:** appends one line (question, first paragraph of the answer, up to 3 citations in that module, date) to the module's Human notes, which bots treat as rules. Audited.
- **Turn into goal:** opens New goal with the question and answer as the brief (`NewGoalDialog` gained an `initialBrief` prop).
- **Entry points:** the Ask tab, ⌘K "Ask the codebase: “<what you typed>”", Ask a bot → "Ask the codebase" in the module panel, the Tour's "Check your understanding".

## C2. Generated docs

- `docs/architecture.md`: Overview (files, modules, languages, areas), Dependency diagram (Mermaid; modules when ≤ 24, otherwise folders two levels deep, 40 heaviest links, import counts on arrows), Modules (table per area with card purpose or derived purpose), Key flows (call paths from entry modules following the heaviest import that leads further, routes per module with `path:line`, the most-imported modules with their first card entry point).
- `docs/decisions.md`: the 25 latest decisions across cards, then all of them by module.
- No model calls: everything comes from the graph and cards.
- Generated parts sit between `<!-- agentroom:begin <id> -->` / `<!-- agentroom:end <id> -->`. Text outside them is never touched. Regenerating some sections replaces only those blocks; missing blocks are appended.
- The UI shows a unified line diff (removed lines first, 3 lines of context, gaps) and per-section checkboxes (only changed sections can be picked). Nothing is written until **Write changes**; each write is audited. The files are written to the working tree for the human to review and commit.

## C3. Onboarding tour

- Order: **Start here** (code modules nothing imports that import others, up to 4), **Core** (imported by ≥ 3 modules, up to 6), **Features** (breadth-first distance from the entry points, then fan-in), **Around the edges** (tests, docs, config, assets).
- Each step: why it's here, purpose (card or derived), up to 3 key files (card entry points first, then the files most used from outside), and a question that opens Ask.
- Progress per git user in `.agentroom/runs/context/tour.json` (done steps and the current one). Steps without a card offer **Write card · ~2¢** for just that module.

## API

| Method | Path | |
|---|---|---|
| GET | `/context/asks` | this person's questions |
| POST | `/context/ask` | `{ question }` → `ContextAsk` (waits for the answer) |
| DELETE | `/context/asks/:id` | |
| POST | `/context/asks/:id/pin` | `{ moduleId }` |
| GET | `/context/docs` | `ContextDocPreview[]` (no writes) |
| POST | `/context/docs/:id/write` | `{ sections? }`, id = `architecture` or `decisions` |
| GET / PATCH | `/context/tour` | `{ done?: Record<id, boolean>, current?, reset? }` |

## Smoke on this repo (593 files, 49 modules, 3 cards)

| Question | Cost | Time | Citations |
|---|---|---|---|
| How does phone approval through the Cloudflare tunnel authenticate requests? | $0.029 | 12 s | 8/8 valid, spot-checked correct |
| What happens when a goal finishes? How does the repo context get updated? | $0.050 | 30 s | 4/4 valid, correct (one wording slip: "`.card.md`") |
| Where is the daily budget enforced before a bot run starts, and what happens when it is used up? | $0.029 | 14 s | 7/7 valid, correct (said "0.01¢" for $0.01) |

## Known gaps

- Answers are not streamed: the request waits (usually 10–30 s) and the UI shows elapsed time and a step hint.
- A citation written outside backticks is checked but not turned into a chip; ranges open the peek at the first line.
- Mermaid isn't rendered in the app (it is on GitHub); the Docs tab shows the diff only.
- The mobile top bar is crowded on every page with page actions; on Ask/Tour/Docs search and Sync hide below `md`.
- The repo name in docs is the folder name.
