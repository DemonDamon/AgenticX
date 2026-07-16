# MySQL Drizzle migrations

This folder is the **MySQL 8.0** migration chain for Enterprise dual-dialect support.

## Rules

- Baseline `0000_mysql_baseline.sql` reflects the final 42-table schema + ordinary VIEW `usage_records_daily_mv`.
- Do **not** port PostgreSQL orphan files `0016_mcp_hosting.sql` / `0025_enterprise_runtime_mcp_servers.sql`.
- Future schema changes must add a new MySQL migration **and** a matching PostgreSQL migration (parity gate).

## Runtime

```bash
DATABASE_DIALECT=mysql
DATABASE_URL=mysql://agenticx:agenticx@127.0.0.1:3306/agenticx
pnpm --filter @agenticx/db-schema db:migrate
pnpm --filter @agenticx/db-schema db:seed
```

## MySQL baseline gotchas (8.0)

- Column defaults must be `DEFAULT (UTC_TIMESTAMP(6))` — bare `DEFAULT UTC_TIMESTAMP(6)` is a syntax error.
- `departments.path` is `varchar(700)` on MySQL (PG keeps 1024) so `UNIQUE(tenant_id, path)` fits the 3072-byte utf8mb4 index limit.
- Composite PK names must be ≤ 64 chars (e.g. `enterprise_runtime_uvm_pk`).

See `enterprise/docs/database/dialect-compatibility-matrix.md` and `cutover-runbook.md`.
