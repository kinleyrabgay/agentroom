---
name: testing
description: Find, write and run tests for a change. Use when verifying behaviour or adding test coverage.
---
# Testing

1. Detect the runner and commands: package.json scripts, pytest.ini, go test, cargo test, Makefile, CI config.
2. Run the relevant suite first to get a baseline; note pre-existing failures separately.
3. Add tests next to similar ones, matching their style: the happy path, edge cases from the acceptance criteria, one failure case.
4. Run again. Record the exact command and a pass/fail summary in the task log; paste failing output verbatim.
5. For UI work, also verify in the browser: load the page, walk the flow, check the console for errors and failed requests.

Never weaken or delete an existing test to make it pass.
