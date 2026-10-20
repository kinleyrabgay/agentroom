---
name: nextjs-app-router
description: Build pages, layouts and components in the Next.js App Router. Use when adding or changing routes, layouts, loading/error states, metadata, or deciding between Server and Client Components.
---
# Next.js App Router

## Before you write code
1. Check the Next.js version in package.json and read `next.config.*`. Follow the version's conventions (e.g. async `params`/`searchParams` in recent versions).
2. Find the nearest existing route that does something similar and copy its structure: folder layout, data loading, styling, components.

## Routing
- A route is a folder under `app/` with `page.tsx`. Shared UI goes in `layout.tsx`; per-segment states in `loading.tsx`, `error.tsx` (a Client Component) and `not-found.tsx`.
- Route groups `(group)` organise without changing the URL. Private folders `_components` keep helpers out of routing.
- Dynamic segments `[id]`; validate the param and call `notFound()` for unknown IDs.
- Set `metadata` or `generateMetadata` on every page: title, description, and Open Graph for public pages.

## Server vs Client Components
- Default to Server Components: fetch data directly, keep secrets on the server, ship less JavaScript.
- Use `"use client"` only for state, effects, event handlers, browser APIs or client-only libraries. Push it to the leaves: pass server-fetched data down as props.
- Never import server-only modules (DB clients, secrets) into client files. Use the `server-only` package where the project does.

## Data and mutations
- Read data in Server Components or cached helpers; mutate with Server Actions or route handlers (see `nextjs-data-and-api`).
- After a mutation, `revalidatePath`/`revalidateTag` what changed, or `redirect`.
- Forms: `useActionState`/`useFormStatus` (or the project's form library) for pending and error states; disable submit while pending.

## UI quality checklist
- Loading skeleton or `Suspense` boundary where data is slow.
- Empty, error and unauthorised states designed, not left blank.
- Works at 375px width, with keyboard only, and in dark mode if the app has one.
- Images via `next/image` with sizes; links via `next/link`.

## Verify
- Open the route in the in-app browser and click through the flow.
- Run typecheck, lint and the tests for the files you touched.
