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

See `enterprise/docs/database/dialect-compatibility-matrix.md` and `cutover-runbook.md`.
