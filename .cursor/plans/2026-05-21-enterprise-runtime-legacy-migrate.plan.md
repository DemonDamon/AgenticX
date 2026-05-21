# Enterprise Runtime Legacy Migration CLI

## Goal

Prevent portal/admin runtime config drift after PG cutover by centralizing legacy JSON → Postgres migration and running it automatically in dev bootstrap.

## Requirements

- FR-1: Shared module `@agenticx/iam-core/runtime-legacy-migrate` imports `providers.json`, `user-models.json`, `quotas.json` into `enterprise_runtime_*` tables when PG is empty.
- FR-2: CLI `pnpm migrate:legacy-runtime` is idempotent and prints per-slice results.
- FR-3: `bootstrap.sh` and local `start-dev.sh` invoke the CLI after `db:migrate`.
- FR-4: web-portal and admin-console reuse the shared migrators instead of duplicating logic.
- AC-1: Fresh PG + existing `.runtime/admin` JSON yields visible models on portal without manually opening admin user pages.

Made-with: Damon Li
