---
name: e2e-playwright
description: Write and run Playwright end-to-end tests for user flows. Use when verifying a feature end to end, adding regression tests for a UI bug, or checking a flow across pages.
---
# End-to-end tests with Playwright

## Setup
- Use the existing config (`playwright.config.*`) and folder (often `e2e/` or `tests/`). If there is none, ask before adding Playwright to the project.
- Start the app the way the config does (`webServer`) or use the running dev server.

## Writing tests
- One test per user goal: "a new user can sign up and lands on the dashboard".
- Locate by role and accessible name: `getByRole('button', { name: 'Upgrade' })`, `getByLabel('Email')`. Fall back to test IDs only if the project uses them.
- Rely on auto-waiting and web-first assertions (`await expect(locator).toBeVisible()`); never `waitForTimeout`.
- Isolate data: create what the test needs (API or seed helper) and don't depend on other tests' state.
- Auth: reuse a stored session state for signed-in tests instead of signing in every time.
- Cover the unhappy paths that matter: validation errors, unauthorised access, empty states.

## Running
- Run only the specs you touched first (`npx playwright test e2e/billing.spec.ts`), then the suite if it's fast.
- On failure read the trace/screenshot, decide whether the product or the test is wrong, and report which.

## Never
- Run E2E tests against production, or with real payment details or personal accounts.
