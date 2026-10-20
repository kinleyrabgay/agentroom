---
name: Reproduce-first fix
description: Prove the bug with a failing test before fixing it. Used by Sentry autopilot.
icon: siren
order: 5
securityReview: auto
fields:
  - id: problem
    label: What breaks?
    placeholder: TypeError in checkout when the cart is empty (WEB-4X)
    required: true
  - id: evidence
    label: Error, stack trace or Sentry link
    placeholder: Paste the stack trace or the Sentry issue link
    multiline: true
---
This goal must prove the bug before fixing it. Plan the tasks in this order:

1. **Reproduce.** Find the code path from the stack trace (start at the innermost in-app frame; use context_find / context_impact). Reproduce it: for UI errors, open the page in the in-app browser and trigger it; for backend errors, call the code with the bad input in a test.
2. **Failing test.** Add a test that fails because of the bug. Run it and confirm it fails for the right reason.
3. **Report.** Call `autopilot_report` with `reproduced`, how you reproduced it, the test file and the exact command that runs only that test (e.g. `npx vitest run test/cart.test.ts`). If you can't reproduce it, call `autopilot_report` with `reproduced: false` and explain what you tried: AgentRoom stops and asks the human instead of guessing a fix.
4. **Fix.** Fix the root cause, not the symptom. Keep the change small and local.
5. **QA.** Re-run the new test and the related suites. AgentRoom then checks on its own that the test fails on the starting commit and passes on the fix.

Mention the issue id in commit messages (e.g. `Fixes WEB-4X`).
