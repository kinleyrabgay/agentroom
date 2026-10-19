# AgentRoom

A visual control room for your coding agents. Run it in any repo to get a team of bots (Team Lead, Planner, Developer, QA and Reviewer) and a shared skill library. A local web UI lets you watch every tool call live, chat with each bot, approve risky actions and assign skills by drag and drop.

```bash
npm i -g agentroom        # or: npm link (from this repo, after npm run build)
cd your-project
agentroom start --provider claude
```

## What it creates

```
.agentroom/
  config.json               # provider, model, permission mode, always-ask commands
  .claude-plugin/plugin.json
  bots/01-team-lead/bot.md  # frontmatter (name, avatar, color, tools, skills, reportsTo) + persona prompt
  bots/02-planner/ …
  skills/<name>/SKILL.md    # Claude skill format
  tasks/board.json          # team task board
  runs/                     # live event logs + sessions (gitignored)
```

These are plain files. Commit them and the whole team shares the same bots and skills. You can edit them by hand and the UI updates live.

## CLI

| Command | |
|---|---|
| `agentroom init` | Scaffold `.agentroom/` (never overwrites) |
| `agentroom start [--provider claude] [--model id] [--port n] [--no-open]` | Start the UI |
| `agentroom bot add "<name>" [--role r] [--reports-to id]` / `bot list` | Manage bots |
| `agentroom skill add <name> [-d desc]` / `skill list` | Manage skills |
| `agentroom doctor` | Check node, git, gh auth, the Claude CLI and the API key |

## How it works

- **Runtime:** each bot runs through the Claude Agent SDK in your project directory. Auth comes from your Claude Code login or `ANTHROPIC_API_KEY`.
- **Skills:** `.agentroom/` is loaded as a local Claude plugin. Each bot only sees the skills assigned to it (`agentroom:<skill>`).
- **Team:** a bot that has reports gets a `delegate` tool. Every bot gets `task_list`, `task_create` and `task_update`.
- **Browser (in-app, no Chrome):** a bot that has the `Browser` tool gets a lightweight preview that runs as an iframe inside the AgentRoom UI. A tiny per-site proxy makes the page frameable, keeps hot-reload websockets working and injects a small bridge script. Through the bridge, bots can `browser_open`, `browser_snapshot` (the page as text with `[ref=…]` handles), `browser_click`, `browser_type`, `browser_press`, `browser_wait_for`, `browser_back`, `browser_console` and `browser_eval`. A cursor in the bot's color shows each action on the page. Small dev tools in the toolbar:
  - element picker: attaches the selector, text and HTML to the bot's chat
  - console: logs, page errors and failed requests
  - take control: pauses the bot's browser actions while you drive
  Opening and reading pages run without asking. Clicking and typing ask for approval ("Always allow Browser"). `browser_eval` always asks separately. The AgentRoom tab must be open for bots to browse.
- **Git and GitHub:** bots inherit your shell environment, including git config, the credential helper or SSH agent, and `gh auth`, so commits and PRs are made as you. No credentials are copied.
- **Safety:** with `permissionMode` set to `ask-writes` (the default), edits and shell commands need your approval in the UI. `ask-all` asks for everything. `auto` only asks for `alwaysAsk` commands (`git push`, `rm -rf`, `gh pr merge`, …), which always need approval and can't be session-allowed. The server binds to 127.0.0.1 and needs a per-run token, which is in the printed URL.

## Develop

The UI in `web/` is Next.js with shadcn/ui (`radix-luma` preset). It's built as a static export and served by the AgentRoom server.

```bash
npm install && npm --prefix web install
npm run build        # web (next export) → dist/ui, CLI (tsup) → dist/cli.js
npm test             # vitest
npm run typecheck
# UI hot reload against a running server:
AGENTROOM_DEV_ORIGIN=http://localhost:3000 agentroom start --no-open   # in a project
npm run dev:web                                                         # then open localhost:3000/?t=<token>
```

Adding a provider means implementing `Provider` in `src/server/providers/` and registering it in `src/server/app.ts`.
