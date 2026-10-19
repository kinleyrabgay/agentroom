# Contributing to AgentRoom

Thanks for helping out. Bug reports, fixes, docs, new skills and new providers are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs:** search [existing issues](https://github.com/kinleyrabgay/agentroom/issues) first, then open one with the bug template.
- **Features:** open an issue to discuss it before writing a large change, so the work isn't wasted.
- **Security issues:** don't open a public issue. Follow [SECURITY.md](SECURITY.md).

## Setup

Requirements: Node.js 20+, git, and a Claude Code login or `ANTHROPIC_API_KEY` to run bots.

```bash
git clone https://github.com/<you>/agentroom.git
cd agentroom
npm install && npm --prefix web install
npm run build
npm link            # optional: puts your local build on PATH as `agentroom`
```

Hot reload for the UI:

```bash
# in a test project
AGENTROOM_DEV_ORIGIN=http://localhost:3000 agentroom start --no-open
# in this repo
npm run dev:web     # open http://localhost:3000/?t=<token>
```

CLI or server changes need `npm run build:cli` and a restart of `agentroom start`.

## Project structure

| Path | Contents |
|---|---|
| `src/cli/` | `agentroom` commands |
| `src/server/` | HTTP/WebSocket server, agents, workflow, safety, integrations, preview proxy |
| `src/core/` | Project files, repositories, git helpers |
| `src/shared/` | Schemas, types and enums shared with the UI |
| `web/` | Next.js UI (static export) |
| `templates/` | Default bots, skills and config |
| `test/` | Vitest tests |
| `docs/` | Roadmap and specs |

## Making a change

1. Fork the repo and create a branch from `main`: `git checkout -b fix/short-description`.
2. Make the change. Match the style of the surrounding code and keep the change focused.
3. Add or update tests in `test/` for behavior changes.
4. Run the full check:

   ```bash
   npm run check     # typecheck + lint + test
   ```

5. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for user-facing changes.
6. Commit with a sign-off (see below) and open a pull request.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(preview): add browser_scroll tool
fix(safety): treat `git push --force` as alwaysAsk
docs: explain permission modes
```

### Developer Certificate of Origin

Every commit must be signed off to certify you wrote it or have the right to submit it under the
project's license ([DCO](https://developercertificate.org/)):

```bash
git commit -s -m "fix: ..."
```

This adds `Signed-off-by: Your Name <you@example.com>` to the message.

## Pull requests

- Keep each PR to one topic. Smaller PRs get reviewed faster.
- Describe what changed and why, and link the issue (`Closes #123`).
- Include screenshots or a short recording for UI changes.
- CI and `npm run check` must pass.
- Changes that touch approvals, the permission gate, the preview proxy or the auth token need extra
  care. Call them out in the PR description.

## Adding a provider

Implement `Provider` in `src/server/providers/provider.ts`, put it in its own folder under
`src/server/providers/`, register a factory in `src/server/providers/registry.ts`, and add a value to
`ProviderId` in `src/shared/enums.ts`.

## Adding a built-in skill or bot

Add a folder under `templates/skills/<name>/SKILL.md` or `templates/bots/<nn>-<id>/bot.md`. `agentroom
init` copies templates and never overwrites existing files.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
