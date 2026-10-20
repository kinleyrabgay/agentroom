---
name: saas-auth-billing
description: Auth, multi-tenant access rules and Stripe billing for a SaaS. Use when touching sign-in, sessions, roles, organisations/teams, plans, checkout, subscriptions or payment webhooks.
---
# Auth, tenants and billing

These areas are security-sensitive: changes here always get a security review.

## Auth and sessions
- Use the project's existing auth library and helpers; never hand-roll password hashing, tokens or cookies.
- Protect pages in middleware *and* check again in every server action / handler (middleware alone is not authorisation).
- Session cookies: `httpOnly`, `secure`, `sameSite=lax` or stricter. Never put tokens in URLs or localStorage.

## Tenants (organisations / teams)
- Every query on tenant data filters by the current tenant. Add the filter in the data-access helper, not in each caller.
- Roles are checked on the server. UI hiding is only cosmetic.
- Invites: single-use, expiring tokens; accepting one checks the email matches.

## Stripe billing
- Prices and plans come from config or Stripe, never from the client request.
- Checkout/portal sessions are created server-side for the signed-in customer only.
- **Webhooks**: verify the signature with the raw body and the endpoint secret; handle each event idempotently (store processed event IDs); return 2xx quickly; derive state from Stripe objects, not from the client.
- Entitlements: one helper decides what a plan allows (`canUse(feature)`), used by both UI and server.
- Test with Stripe test mode and recorded fixtures. Never use real cards or live keys in tests or the browser.

## Never
- Log secrets, tokens, full card data or webhook payloads with personal data.
- Commit `.env*` files or keys. Ask a human for any credential you need.
