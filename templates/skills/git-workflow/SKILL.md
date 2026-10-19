---
name: git-workflow
description: Safe git conventions for branches, commits and pull requests. Use whenever creating branches, committing, or opening PRs.
---
# Git workflow

- Check `git status` first. Never discard changes you did not make.
- Work on a branch: `git switch -c agentroom/<task-id>` (or reuse it if it exists).
- Stage only files you changed: `git add <paths>` — not `git add -A`.
- Commit messages: imperative subject ≤ 60 chars, blank line, body explaining why.
- Never force-push, never rewrite shared history, never commit secrets or `.env` files.
- Push and `gh pr create` only when asked. PR body: summary, how to test, risks.
