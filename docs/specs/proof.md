# Proof of work and quality gates (0.1)

Platform plan B1 + B2. A goal's "done" now carries evidence: a recording of the feature working in a real browser, before/after screenshots and quality checks, shown on the goal's **Proof** tab and in the PR.

## Flow

Plan → Review → Build → Security → Test → **Verify** → Report.

1. After QA passes, the goal enters `verifying` when proof is on (`settings.proof.enabled`) and the goal's folder has a web app (a `dev`/`start`/`serve` script in package.json, `proof.devCommand`, or `proof.url`). Otherwise it goes straight to Report.
2. The first time, QA writes the scenario (`verifyPrompt`): 1–2 scenarios as a ```json block. Steps use the browser vocabulary bots know: `goto`, `click`, `fill`, `press`, `wait`, `expect`, `screenshot`. Targets are CSS selectors or `text=…`; paths must stay on the app (relative, or localhost URLs). QA can answer `{ "scenarios": [] }` for changes with no UI; Verify is then recorded as skipped. The scenario is saved and reused in later rounds; the human can edit it on the Proof tab.
3. The engine (no LLM) starts the app from the goal's worktree on a free port (`$PORT`, plus `-p` / `--port … --strictPort` for Next, Vite, Astro, SvelteKit, Nuxt), runs each scenario in headless Chrome at 1280×800, saves a PNG after load and after each step, and encodes a looping GIF.
4. With `proof.before` on, it creates a detached worktree at the goal's `baseRef`, starts the app there too and screenshots the same pages. That gives before/after images, a visual diff and a baseline for accessibility.
5. The checks run, and the report is written to `runs/proof/<G-n>/report.json` with its frames.
6. What happens next depends on the result:
   - **A scenario failed** (the feature doesn't work): a Bug task is created for the Developer with the failing step. QA tasks reopen and the goal goes back to Building for another round. After `MAX_FIX_ROUNDS` it pauses instead.
   - **A check failed and `quality.gate` is on:** the goal pauses with the reason `Quality gate: …`. **Resume** or **Accept and continue** records `proofOverride` (audited) and continues to Report.
   - **Infrastructure problems** (no browser, the app won't start): proof is recorded as `error`/`skipped` and the goal continues. An Info notification is sent for errors. Proof never fails a goal on its own.

## Quality checks

| Check | Measures | Can fail? |
|---|---|---|
| Accessibility | axe-core when installed (project or next to AgentRoom), else built-in rules: alt text, button/link names, form labels, `lang`, duplicate label ids. Serious and critical issues only. | Yes: new issues vs the starting commit > `maxNewA11yIssues`. Without a baseline it can only warn. |
| Performance | LCP, CLS and transfer size from the Performance API | No, warn only (it's a dev server) |
| Visual change | Pixel diff per page vs the starting commit | No: flags pages above `maxVisualDiffPct` for a look |
| Coverage | Runs `quality.coverageCommand` on both sides; reads `coverage/coverage-summary.json` or `lcov.info` | Yes: drop > `maxCoverageDrop` points (off by default) |
| Bundle size | Runs `quality.buildCommand` on both sides; sums JS/CSS in `.next/static`, `dist`, `build`, `out` or `bundleDir` | Yes: growth > `maxBundleGrowthPct` (off by default) |

Failing checks add a `Quality: …` factor to the risk score: 10 points each, at most 20. A failed scenario adds 15. These factors are recomputed on every risk update.

## PR

`prDraft` appends a **Proof** section: a ✅/❌ line per scenario and a check table, followed by the `<!-- agentroom:proof -->` marker.

When the PR is opened (`openPr`) with `proof.publish = "branch"` (the default):
1. The GIF and the last before/after frames are committed to the orphan branch `agentroom/proof` under `G-n-r<round>/`. This uses git plumbing and a temporary index, so it doesn't touch any working copy, and it builds on origin's tip so other goals' proof stays.
2. The branch is pushed, and the push is audited.
3. The marker section is replaced with `github.com/<repo>/blob/<sha>/…?raw=true` image links.

With `publish = "local"`, or if the push fails, the PR keeps the table only and the images stay in `runs/proof/`.

## Settings

Two settings blocks, both on the Team / Just me overlay.

**`proof`**
- `enabled`
- `publish` (`branch` | `local`)
- `devCommand`
- `url`
- `before`
- `startTimeoutSec`
- `mask` (CSS selectors blurred in screenshots; defaults cover password inputs and `[data-secret]`)

**`quality`**
- `gate`
- `a11y`, `maxNewA11yIssues`
- `perf`, `maxLcpMs`
- `visual`, `maxVisualDiffPct`
- `coverage`, `coverageCommand`, `maxCoverageDrop`
- `bundle`, `buildCommand`, `bundleDir`, `maxBundleGrowthPct`

## Dependencies

- `playwright-core` is an **optional dependency**, loaded at runtime: next to AgentRoom (including a global install), else from the project. It uses the system Chrome, Chromium, Edge or Brave, or `AGENTROOM_CHROME`; no browser download.
- `agentroom doctor` reports whether proof recording is available.
- The PNG decoder, GIF encoder (LZW, fixed 256-colour palette) and image diff are pure JS (`src/server/proof/image.ts`).

## API

- `GET /api/proof/availability`
- `GET /api/goals/:id/proof` → `{ report, scenarios, availability, running }`
- `GET /api/goals/:id/proof/files/:name`: PNG/GIF/JSON from the goal's proof folder. The name is validated. The query token is accepted for `.png`/`.gif` only, like uploads, so `<img src>` works.
- `POST /api/goals/:id/proof/run`: record again (when the goal isn't running)
- `POST /api/goals/:id/proof/override`: accept failing checks, which resumes a goal held at the gate
- `PUT /api/goals/:id/proof/scenarios`: validated, audited

## Files

- **Server:** `src/server/proof/{image,scenario,checks,devserver,browser,recorder,publish,proof.service}.ts`, `src/server/http/routes/proof.routes.ts`
- **Runner:** Verify step in `src/server/workflow/goal-runner.ts`, `verifyPrompt` in `prompts.ts`, the `sections` argument in `pr-body.ts`
- **Git:** `createDetachedWorktree` in `src/server/git/goal-git.ts`
- **Web:** `web/features/proof/*`; Proof tab in `goal-tabs.tsx` / `task-board.tsx`; Verify step in `PHASES` / `goal-phase.ts`; `web/features/settings/components/proof-section.tsx`
- **Tests:** `test/proof.test.ts`, `test/proof-runner.test.ts`

## Known limits

- **The agent writes the scenario.** A wrong selector looks like a broken feature; the Developer's bug task says to flag a wrong scenario, and the human can edit it.
- **Monorepos:** the app is started from the worktree root. Use `proof.devCommand` (e.g. `npm --prefix apps/web run dev`).
- **Next.js with Turbopack** can refuse a symlinked `node_modules` outside the project root. If the dev server won't start in a goal folder, set `proof.devCommand` to `next dev --webpack`.
- **Accessibility without axe-core** uses a small rule set; installing `axe-core` in the project upgrades it automatically.
- **Images in private repos** render for people who can see the repo; the proof branch grows over time and is safe to delete.
