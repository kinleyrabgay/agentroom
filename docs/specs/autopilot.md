# Autopilot: Sentry incidents and Figma → UI (0.5)

Platform plan B3 + A4. Two goal types that end with evidence measured by AgentRoom itself, not just a bot's word:

- **Incident autopilot:** Sentry error → reproduce → failing test → fix → verify → PR, with a confidence score.
- **Implement design:** Figma frame (or design image) → UI → a design-match score in Verify and the PR.

## Incident autopilot

### How it starts

- **Trigger:** Automation → New trigger → *When Sentry reports a new issue / sees an issue spike … then* **run autopilot**.
  - Choose *stop after the plan* (default) or *build without waiting*.
  - Choose *wait for me before the PR* (default) or *open the PR when confident*.
  - Only Sentry triggers can use autopilot.
- **By hand:** Sentry → an issue → Inspector → **Autopilot → Run autopilot**. Starting it by hand never opens a PR on its own.
- **Spike triggers** (`when.event: "spike"`, `when.spike: { factor, windowMin, minEvents }`):
  - Every 5 minutes the poll records event counts per issue (sorted by last seen, 24 h).
  - It fires when the last window has at least `factor` × the window before and at least `minEvents` events.
  - It needs two full windows of history, so connecting Sentry never fires on old volume.
  - It fires once per issue per trigger per day.
  - Code: `src/server/automation/spike.ts`.

### The goal

`AutopilotService.startFromSentry` starts a goal from the **Reproduce-first fix** template (`templates/goal-templates/reproduce-first.md`):

- **Brief:** the usual Sentry brief (stack trace, breadcrumbs), marked as untrusted data.
- **Sources:** the issue, so the PR says `Fixes <SHORT-ID>`.
- **`goal.autopilot`:** issue, trigger, `autoPr`, status.
- **Duplicates:** a second start for the same issue is refused while a goal for it is open.

Bots in an autopilot goal get one extra host tool, **`autopilot_report`**: `{ reproduced, how, testFile?, testCommand? }`.

| Report | What happens |
|---|---|
| `reproduced: false` | Before its next step, the runner pauses the goal ("Autopilot: couldn't reproduce …") and an Inbox *Blocked* note is sent. It doesn't guess a fix. After the human adds details and resumes, the goal continues. |
| `reproduced: true` | The test file and command are stored, but only if both pass the safety checks below. |

### Verification (fail → pass)

Before the report phase, AgentRoom runs the reported test itself:

1. **On the fix:** in the goal's folder. It must exit 0.
2. **On the starting commit:** in a throwaway detached worktree of `baseRef` (under `~/.agentroom/worktrees/<repo>/.autopilot/`), with the test file copied in. It must fail.
3. **Status:** both hold → `verified`; otherwise `unverified`, with the output tail. Re-run with **Check again** on the Proof tab (`POST /api/goals/:id/autopilot/verify`).

**Test commands run without approval, so they're restricted** (`src/server/autopilot/verify.ts`):

- Only known test runners: vitest, jest, mocha, `npm`/`pnpm`/`yarn`/`bun test`, `node --test`, pytest, `go test`, `cargo test`, `dart`/`flutter test`, rspec, phpunit/pest, `mvn`/`gradle test`, `swift test`, `dotnet test`, `mix test`.
- No shell metacharacters or quotes; the command is split into argv and run with `shell: false`.
- No absolute paths and no `..`.
- The test file must exist inside the goal's folder.
- 5-minute timeout per side.

### Confidence (0–100)

Computed from evidence AgentRoom measured (`src/server/autopilot/confidence.ts`):

| Evidence | Points |
|---|---|
| Reproduced | 20 |
| Test fails on the starting commit | 25 |
| Test passes on the fix | 25 |
| Small blast radius: modules affected by the changed files (context map impact): ≤1 → 15, ≤3 → 10, ≤6 → 5 | 15 |
| Low risk: `10 × (1 − risk score / 100)` | 10 |
| Browser checks pass (no UI → 3) | 5 |

- **Unknowns score 0.**
- **Caps:** a test that fails on the fix caps the score at 30; "not reproduced" caps it at 10.

### PR

When the goal is done:

- **The PR opens on its own only if all of these hold:**
  - the trigger says *open the PR when confident* (`then.autoPr`);
  - **Settings → Autopilot → Allow PRs without me** (`settings.autopilot.allowAutoPr`, **off by default**);
  - confidence ≥ `settings.autopilot.minConfidence` (default 80);
  - the test was verified on both commits.
- **Auto-opened PRs:** audited (`actor: system/autopilot`) and announced in the Inbox.
- **Otherwise:** status `ready`, and an Inbox note: "Autopilot fix ready: confidence N/100 …".
- **PR body:** an **Autopilot** section (how it was reproduced, the test, the fail/pass result, the confidence table) plus `Fixes <SHORT-ID>`.

### UI

- **Proof tab (autopilot goals):** an Autopilot card.
  - Steps: reproduce, failing test, fails before, passes after.
  - The confidence meter with every factor, and **Check again**.
- **Goal header:** a *Confidence N* badge.
- **Sentry Inspector:** an Autopilot section with **Run autopilot** and the issue's runs (status, confidence, PR, Open).
- **Automation:**
  - the trigger sentence shows `run autopilot, stop after the plan, and wait for you before the PR`;
  - spike triggers read `a Sentry issue spikes ×3 within 1 hour`.
- **Settings → Autopilot:** *Allow PRs without me*, *Minimum confidence*.

## Implement design (Figma → UI)

### Starting it

**New goal → Implement design** (`templates/goal-templates/implement-design.md`, frontmatter `design: true`). Fields:

- **Figma frame link:** must contain `node-id`.
- **Or a design image:** a new template field kind, `image: true`. It's uploaded and attached to the goal; PNG, JPG or WebP.
- **Page to build:** a path such as `/pricing`.
- **Frame size:** e.g. `1440x900`. When empty, it's read from Figma or from the image.
- **Notes.**

`POST /api/goals` builds `goal.design` from those fields (`designFromFields`). A link without `node-id`, or neither a link nor an image, is refused with a clear message.

**Figma for bots:** two MCP presets, **Figma** (remote, OAuth) and **Figma (access token)** (`figma-developer-mcp`, secret `FIGMA_ACCESS_TOKEN`). The template's guidance tells the Planner and Developer to read the frame's design context with them.

### Verify: design match

When the goal has `design` and `quality.design` is on, the Verify phase (`ProofService.designMatch`):

1. **Gets the reference** and caches it as `design-source.*` in the proof folder (`src/server/autopilot/design.ts`):
   - the uploaded image; or
   - the Figma frame exported over the **REST API** (read-only: `GET /v1/images/:key?ids=…&format=png&scale=1`, plus `/v1/files/:key/nodes` for the size), using `FIGMA_ACCESS_TOKEN` from `runs/secrets.json`.
   - With neither, the check is **skipped** and the reason says what to add.
2. **Normalises it in the headless browser** (any image format) to `design-ref.png` at the frame size. A wide image without a size is treated as a 2× export.
3. **Renders the page** at the frame size → `design-shot.png`. The proof mask selectors are blurred.
4. **Scores it** (`src/server/proof/design-match.ts`):
   - both images are scaled to the same width (size-normalised), over their common height;
   - **structure** (SSIM on luminance at 128 px wide) 55%;
   - **pixel match** (at 256 px) 30%;
   - **proportions** (page scroll height vs frame height) 15%;
   - structure and pixels count only windows that have content in either image, so empty background can't hide a misplaced element.
5. **Writes `design-diff.png`:** the page faded, with differing pixels in red.
6. **Check:** `design`. It fails below `quality.minDesignMatch` (default 70), which pauses the goal at the quality gate like other checks (Accept and continue overrides it).

**Shown in:**
- **Proof tab:** the Design match card. Side by side (design | implementation), Differences, and metric bars; click to enlarge.
- **PR:** "Design match: N/100" plus the two images when proof publishing is on (pushed to `agentroom/proof` with the other frames).

## Settings

- `settings.autopilot`: `{ allowAutoPr: false, minConfidence: 80 }`
- `settings.quality`: `design: true`, `minDesignMatch: 70`

## Files

**Shared (additive):**
- `schemas.ts`: `GoalAutopilotSchema` and `GoalDesignSchema`; `Goal.autopilot` and `Goal.design`; the Sentry trigger `event: 'new_issue' | 'spike'` plus `spike`; `then.type` gains `'autopilot'` plus `then.autoPr`; the `settings.autopilot` block; `quality.design` and `quality.minDesignMatch`.
- Types: new `types/autopilot.ts`; `ProofCheckId` gains `'design'`; `ProofReport.design`; template field `image` and template `design` flag; `HostTool.AutopilotReport`.

**Server:**
- `src/server/autopilot/{autopilot.service,confidence,verify,design}.ts`
- `src/server/automation/spike.ts`
- `src/server/proof/design-match.ts`
- `src/server/agents/tools/autopilot.tools.ts`
- `src/server/http/routes/autopilot.routes.ts`

**Runner** (`goal-runner.ts`):
- `AutopilotHooks` (`gate`, `beforeReport`, `afterDone`, `prSection`)
- `setDesign`
- the gate check in `drive`
- the autopilot section in `prDraft`

**Wiring:**
- `server/index.ts`: autopilot service; proof `designReference`; automation `startAutopilot`; `sentryIssues({ sort })`.
- `app.ts`: routes.
- `team.ts` and `tools/index.ts`: the reporter.
- `presets.ts`: Figma presets.
- `goals.routes.ts`: design from fields.

**Web:**
- `web/features/autopilot/*`
- `proof/components/design-match-card.tsx`
- `tasks/components/image-field.tsx`
- edits to: `trigger-dialog.tsx`, `automation-page.tsx`, `issue-inspector.tsx`, `proof-panel.tsx`, `goal-header.tsx`, `new-goal-dialog.tsx`, settings (`proof-section.tsx`, `constants.ts`, `scope.ts`, `settings-page.tsx`), and `endpoints.ts` (`autopilotApi`).

**Tests:**
- `test/autopilot.test.ts`
- `test/autopilot-runner.test.ts`
- `test/design.test.ts`
- `test/automation-extras.test.ts` (6 templates)

## Known limits

- **Who writes the test:** the bot writes the reproduction test and picks its command. AgentRoom verifies fail → pass but can't judge whether the test reproduces *this* Sentry error rather than a similar one. The PR shows how it was reproduced so a human can judge.
- **Copying the test to the starting commit:** a test that imports a helper added by the fix fails there for the wrong reason (missing import) and still counts as "fails before". The output tail is kept for review.
- **Risk score:** confidence's risk factor needs the security layer's risk score; without it that factor scores 0.
- **Spike detection:** it only sees issues in the latest page (24 h, sorted by last seen), and needs AgentRoom running for two windows.
- **Design match:**
  - It's a perceptual score, not a spec diff: copy, fonts and anti-aliasing all count.
  - Frames taller than 4000 px are cut.
  - Pages behind a login need `proof.url` or a scenario that signs in first; the design shot renders the path directly.
- **Schedules:** schedules with the Implement design template don't carry the design (they start from the composed brief only).
