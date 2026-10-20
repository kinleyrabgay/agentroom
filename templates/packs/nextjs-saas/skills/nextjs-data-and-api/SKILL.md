---
name: nextjs-data-and-api
description: Server Actions, route handlers, data access and caching in a Next.js app. Use when adding a mutation, an API endpoint, a webhook receiver, or changing how data is fetched or cached.
---
# Data, Server Actions and route handlers

## Pick the right tool
- **Server Action** (`"use server"`): mutations from your own UI (forms, buttons). Typed, no extra endpoint.
- **Route handler** (`app/api/**/route.ts`): endpoints called by others: webhooks, mobile apps, cron, public API.
- **Server Component fetch / data helper**: reads.

## Every mutation, in this order
1. **Authenticate**: get the session on the server. No session → return an unauthorised result.
2. **Validate input** with zod (or the project's validator). Coerce types; reject unknown fields.
3. **Authorise**: check the user may act on *this* record (owner, organisation membership, role). Look the record up by ID *and* tenant, never by ID alone.
4. **Do the work** through the existing data layer. Wrap multi-step writes in a transaction.
5. **Revalidate** affected paths/tags, then return a typed result (`{ ok: true, data }` / `{ ok: false, error }`). Don't throw raw errors to the client.

## Route handlers
- Export only the methods you support. Return `NextResponse.json` with correct status codes (400 validation, 401/403 auth, 404, 409 conflict).
- Read secrets from env on the server only. Never log request bodies that may contain personal data or tokens.
- Rate-limit public endpoints if the project has a limiter.

## Caching
- Know the version's default caching behaviour before relying on it. Mark per-user data as dynamic; tag shared data and revalidate the tag on writes.
- Don't cache responses that depend on cookies or headers unless keyed by them.

## Tests
- Unit-test the action/handler logic with a test database or the project's mocks: happy path, invalid input, unauthorised, wrong tenant.
