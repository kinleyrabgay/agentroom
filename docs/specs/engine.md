# Engine: providers, routing and the learning loop (0.6)

Two parts: **E1** runs phases on providers besides Claude, with fallbacks; **E2** measures what works (outcomes, experiments, suggestions, replay evals). Claude stays the default and the reference: with only Claude present nothing changes.

## E1. Providers and routing

### Providers

| Provider | How it runs | Approvals | AgentRoom tools | Chat history | Spend |
|---|---|---|---|---|---|
| **Claude** (default) | Claude Agent SDK | Each risky command (permission gate, alwaysAsk, security gates) | In-process MCP | Kept | Exact |
| **Codex** (experimental) | `@openai/codex-sdk` (`codex exec`), optional peer dependency | None per command: Codex sandbox (`read-only` or goal folder; network off by default), approval policy `never` | MCP over HTTP (bridge) | Kept (thread id) | Estimated from tokens × your prices |
| **Gemini** (experimental) | `gemini -p … --output-format stream-json` | Gemini approval mode (`default` refuses risky tools headless, `auto_edit`, `yolo`) + its sandbox | MCP over HTTP via a per-run system settings file | Fresh each run | Estimated |
| **OpenAI-compatible** (experimental) | AgentRoom's own tool loop against `/v1/chat/completions` (Ollama, LM Studio, vLLM…) | Each write/command through the same permission gate as Claude; file tools confined to the run folder | Function calling | Fresh each run | Estimated (0 for local) |

Install / sign-in:

- Codex: `npm install -g @openai/codex-sdk` (next to a global AgentRoom), then `codex login`, or save an OpenAI API key in Settings → Providers. Not an optional *dependency* on purpose: its native binary is ~340 MB per platform.
- Gemini: `npm install -g @google/gemini-cli`, run `gemini` once to sign in, or save a Gemini API key.
- OpenAI-compatible: start Ollama / LM Studio; set the endpoint and default model in Settings → Providers. Pick a model trained for tool use.

Keys live in `.agentroom/runs/secrets.json` (`providers.<id>`), mode 0600, write-only over the API.

### Host-tool bridge

`src/server/providers/host-bridge.ts`: a stateless MCP server (streamable HTTP, JSON responses: `initialize`, `ping`, `tools/list`, `tools/call`) at `POST /__agentroom/mcp/<run token>`. Each run registers its host tools under a random token that is disposed when the run ends. Outside the session-token API, but the tunnel guard 404s it, so it is local only. Arguments are validated with the tools' zod schemas.

### Routing

`settings.models.<phase>` gains `provider` and `fallbacks: [{ provider, model? }]` (max 4). `planRoute()` (`src/server/providers/router.ts`):

1. First choice: the phase's provider (else the project provider from `config.json`), with the phase model (else the bot's model, else the project model). Providers ignore model ids that aren't theirs (a Claude id on Codex means "Codex's default").
2. Then the phase's fallbacks, in order.
3. Then Claude as the implicit last resort, unless already in the chain.

`Team.runRoute()` moves on only when an attempt **failed before any tool call** and the reason is one another provider wouldn't share: `not-installed`, `auth`, `rate-limit` (setting), `outage` (setting), or any error when "On other errors" is on. A run that did something is never retried elsewhere. Sessions are only resumed on the first-choice provider. The chat shows `↪ Codex is rate-limited, so this run continues on Claude.`

Settings → General keeps a phase's provider/fallbacks when its model changes (the whole phase object is sent).

### Ledger

`LedgerEntry` gains `provider`, `fellBackFrom[]` and `variants{experimentId: variantId}`. Old rows have no `provider` (= Claude).

### Cost preview

`GET /api/engine/estimate`: per phase, the median of what that phase cost in finished goals on the same provider + model (≥3 goals), else the same provider, else any; total = sum of medians.

## E2. Learning loop

### Outcomes (`runs/outcomes.json`)

For finished goals: status, fix rounds (`round − 1`, +1 if review comments were sent), cost from the ledger, and when the goal has a PR and `engine.learning.trackOutcomes` is on, `gh pr view --json state,mergedAt,mergeCommit` (read-only) and a revert check (`git log --all --grep "This reverts commit <merge sha>"`). Open PRs are re-checked at most hourly; closed/reverted ones are final.

Label: **success** = done, PR not closed unmerged, not reverted (no PR counts as kept); **failure** = failed / cancelled / closed / reverted; **pending** = PR still open or goal not finished.

### Experiments (`runs/experiments.json`)

One bot (optionally one phase), two variants: *As is* (control) and *With change* (skills added/removed, instructions appended). New goals are assigned to the variant with the fewest goals so far and keep it for every run (`ExperimentStore.forRun`, applied in `Team.run` to a copy of the bot). One running experiment per bot+phase.

Results compare decided goals per variant: success rate, average cost, average fix rounds, and a **two-sided Fisher exact test** on success. Nothing is called until every variant has `minSamples` decided goals (default 10); a winner needs p < 0.05.

### Suggestions

From the last 30 days of the ledger:

- **Add a skill:** a bot with ≥5 runs failing ≥30% → the library skill whose name/description best matches words in its errors. Actions: **Apply** (assign the skill), **Test first** (start an experiment), dismiss.
- **Cheaper model:** a phase with ≥10 Opus-class runs, ≥90% success and median ≥$0.50 → try Sonnet. Apply sets `settings.models.<phase>.model`.

Nothing is applied without a click; applying is audited.

### Replay evals (`runs/evals.json`)

Re-run a finished goal's planning with a change: the Planner (with the variant applied, tools limited to Read/Grep/Glob, no host tools, any other tool refused) in a throwaway detached worktree at the goal's starting commit (`~/.agentroom/worktrees/<repo>/.evals/<id>`), capped at `engine.learning.evalBudgetUsd` (default $0.50). The output sits next to the goal's original plan in a compare dialog. One at a time; ledger rows use bot id `eval` ("Replay evals" on Insights).

## API

| Route | |
|---|---|
| `GET /api/engine/providers` | Availability, version, auth, guarantees, models (openai-compat `/models`) |
| `PUT /api/engine/providers/:id/key` `{ key }` | Save/clear a provider key (write-only, audited) |
| `GET /api/engine/estimate` | Cost preview |
| `GET /api/engine/outcomes`, `POST …/outcomes/refresh` | Outcome labels |
| `GET/POST /api/engine/experiments`, `PATCH/DELETE …/:id` | Experiments with results |
| `GET /api/engine/suggestions`, `POST …/:id/apply` `{ mode: apply\|experiment }`, `POST …/:id/dismiss` | Suggestions |
| `GET/POST /api/engine/evals` | Replay evals |
| `POST /__agentroom/mcp/:token` | Host-tool MCP bridge (local only) |

## UI

- **Settings → Providers:** provider rows (Ready / Not installed / Not signed in, Experimental badge) that expand to guarantees, notes, provider settings (Codex sandbox + network, Gemini approval mode + sandbox, endpoint/model/turns for OpenAI-compatible, token prices) and a write-only API key field; provider + model + fallback chain per phase; fallback switches; cost of a typical goal.
- **Insights → Experiments:** suggestions, experiments with a variant table and verdict, replay evals with a side-by-side compare. Insights → Overview is unchanged.
- `agentroom doctor` lists each provider's state.

## Files

- `src/server/providers/{host-bridge,router,status}.ts`, `providers/shared/run-events.ts`, `providers/{codex,gemini,openai-compat}/*.provider.ts`, `registry.ts` (ProviderPool)
- `src/server/engine/{engine.service,experiments,outcomes,suggestions,stats}.ts`
- `src/server/http/routes/engine.routes.ts`, `src/shared/types/engine.ts`
- `web/features/engine/components/{providers-section,experiments-panel}.tsx`
- `test/engine.test.ts` (30 tests)

## Limits

- Codex, Gemini and OpenAI-compatible are verified with mocks only (none installed on the dev machine); they are labelled Experimental.
- Gemini runs don't resume chat history; Codex/Gemini can't ask per command, so prefer them for phases in a goal's own folder.
- OpenAI-compatible has no web tools and no streaming; tool use depends on the model.
- Budget caps can't stop Codex/Gemini mid-run (no per-run cap in their CLIs); spend is estimated afterwards from tokens.
- Experiments test skills and instructions, not models (switch a phase's model for that).
