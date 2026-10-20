---
name: db-migrations
description: Safe database schema changes with Prisma or Drizzle. Use when adding or changing tables, columns, indexes or relations, or writing a data migration.
---
# Database migrations

## Find out what the project uses
- Prisma: `prisma/schema.prisma`, migrations in `prisma/migrations/`. Drizzle: `drizzle.config.*`, schema in `db/schema*` or similar, migrations in `drizzle/`.
- Read the scripts in package.json (`db:migrate`, `db:generate`, …) and use them.

## Rules
- Change the schema, then **generate** a new migration. Never edit a migration that may already be applied anywhere.
- Run migrations only against the local/dev database. Never point a command at staging or production.
- Make changes backward compatible so old code keeps working during deploy:
  - Add columns as nullable or with a default; backfill; then make them required in a later migration.
  - Rename = add new, copy, switch code, drop old later. Never rename in place.
  - Drop columns only after no code reads them.
- Large tables: add indexes concurrently where supported; avoid long locks.
- Data migrations are separate, idempotent and re-runnable.

## In the task log, record
- The migration name, what it changes, whether it locks or rewrites a table, and how to roll back.

## Verify
- Migrate a fresh local database from scratch and from the previous state.
- Regenerate the client/types and run typecheck and the tests that touch the changed models.
