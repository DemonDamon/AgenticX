# Enterprise Database Dialect Cutover Runbook

## Supported modes

| Mode | Env |
|---|---|
| PostgreSQL (default) | `DATABASE_DIALECT=postgresql` + `postgresql://...` |
| MySQL 8.0 | `DATABASE_DIALECT=mysql` + `mysql://...` |

Same Portal / Admin / Gateway images; switch via env and restart all three.

## Fresh install (MySQL)

1. Provision MySQL 8.0.x (pin minor version used in CI, currently 8.0.36 in workflow).
2. Set env on portal, admin, gateway:
   - `DATABASE_DIALECT=mysql`
   - `DATABASE_URL=mysql://...`
3. `pnpm --filter @agenticx/db-schema db:migrate`
4. `pnpm --filter @agenticx/db-schema db:seed`
5. Start stack; verify `/readyz` reports database healthy and dialect.

## Offline PG → MySQL cutover (maintenance window)

1. Announce maintenance; stop user traffic to portal/admin/gateway.
2. Take PostgreSQL backup + MySQL empty target snapshot plan.
3. Dry-run:
   ```bash
   PG_SOURCE_DATABASE_URL=postgresql://... \
   MYSQL_TARGET_DATABASE_URL=mysql://... \
   pnpm db:migrate:pg-to-mysql --dry-run --report .runtime/db-migration-report.json
   ```
4. Real migrate:
   ```bash
   pnpm db:migrate:pg-to-mysql --batch-size 1000 --report .runtime/db-migration-report.json
   ```
5. Confirm report `ok=true`, row counts and checksums for all 42 tables.
6. Point all three services to MySQL env; restart.
7. Smoke: login, chat history, policy publish, gateway audit write, quota increment.
8. Open traffic.

## Rollback

### Before any MySQL user writes

Restore previous `DATABASE_DIALECT` / `DATABASE_URL` to PostgreSQL and restart portal, admin, gateway.

### After MySQL has accepted user writes

**Do not** silently switch back to the old PostgreSQL instance — new MySQL writes would be lost.
Required path: reverse migrate or restore from backup with explicit data-loss acceptance and a new maintenance window.

## Failure triage

| Symptom | Check |
|---|---|
| Startup fails on dialect/URL mismatch | Fix env; fail-fast is intentional |
| Migrate refuses non-empty target | Use `--force-empty-target` only on disposable DBs, or `--resume` |
| Soft-delete email unique conflict | Confirm `active_email_key` generated column on MySQL `users` |
| Audit duplicate inserts | MySQL uses `ON DUPLICATE KEY UPDATE id = id` (not `INSERT IGNORE`) |
