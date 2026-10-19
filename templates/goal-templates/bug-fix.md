---
name: Bug fix
description: Reproduce, write a failing test, fix the cause, verify.
icon: bug
order: 1
securityReview: auto
fields:
  - id: problem
    label: What breaks?
    placeholder: Logout stalls and throws when sign_out returns 504
    required: true
  - id: reproduce
    label: How to reproduce
    placeholder: Steps, URL, account, or the Sentry / GitHub link
    multiline: true
  - id: expected
    label: What should happen instead
    multiline: true
---
1. Reproduce the bug first: find the code path from the steps above and confirm the cause by reading the code (and logs or stack traces if given).
2. Plan a dev task that adds a failing test for the bug, then fixes the root cause rather than the symptom.
3. Keep the change small and local. Note any related problems in the task log instead of fixing them.
4. Plan a QA task that re-runs the reproduction steps (in the in-app browser for UI bugs) and the relevant test suites.
