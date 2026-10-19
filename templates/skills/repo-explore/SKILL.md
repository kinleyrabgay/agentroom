---
name: repo-explore
description: Quickly map an unfamiliar repository. Use before planning or changing code you have not seen.
---
# Repo exploration

- Read the manifest first (package.json, pyproject.toml, go.mod, Cargo.toml) for scripts, deps, entry points.
- Read README and any CLAUDE.md / CONTRIBUTING.md.
- `Glob` the top two levels of the source tree; identify layers (routes, services, data, UI).
- Find where a feature lives by grepping user-facing strings or route paths, then follow calls.
- Locate tests and how they run.

Report as: entry points, key modules (path — purpose), test command, conventions noticed.
