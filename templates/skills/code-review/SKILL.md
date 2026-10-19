---
name: code-review
description: Review a diff for correctness bugs first, then simplifications. Use when reviewing changes or before opening a PR.
---
# Code review

- Get the diff: `git diff $(git merge-base HEAD origin/HEAD 2>/dev/null || echo main)...HEAD` or `git diff` for uncommitted work.
- For each hunk ask: what input breaks this? what happens on error? is it reachable by untrusted data?
- Check that tests cover the change.
- Output one line per finding, most severe first: `path:line — problem — suggested fix`.
- If nothing is wrong, say so plainly. No praise padding.
