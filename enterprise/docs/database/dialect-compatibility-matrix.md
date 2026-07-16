# Enterprise Database Dialect Compatibility Matrix

> Generated for Plan `2026-07-15-enterprise-mysql-dual-dialect-compatibility`.
> Source of truth for PostgreSQL ↔ MySQL type / constraint / index mapping.

## Runtime switch

| Variable | Allowed values | Notes |
|---|---|---|
| `DATABASE_DIALECT` | `postgresql` \| `mysql` | Required when dual-dialect code path is enabled |
| `DATABASE_URL` | dialect-compatible URL | Must match dialect (`postgres://` / `postgresql://` for PG; `mysql://` for MySQL) |

Default for local/dev remains **PostgreSQL**. MySQL is opt-in via env.

## Type mapping

| Capability | PostgreSQL | MySQL 8.0 | Notes |
|---|---|---|---|
| Primary keys (ULID) | `varchar(26)` | `varchar(26)` | Same |
| Booleans | `boolean` | `boolean` / `tinyint(1)` | Drizzle mysql maps to tinyint(1) |
| Timestamps | `timestamptz` | `datetime(6)` | Store UTC; app layer normalizes |
| JSON documents | `jsonb` | `json` | Prefer structured JSON columns |
| String arrays | `text[]` | `json` | Serialize as JSON array of strings |
| Integers / bigint | `integer` / `bigint` | `int` / `bigint` | Same semantics |
| Soft-delete flags | `boolean` + nullable `timestamptz` | `boolean` + nullable `datetime(6)` | Same |

## Constraint / index mapping

| Capability | PostgreSQL | MySQL 8.0 | Notes |
|---|---|---|---|
| Unique indexes | native unique | native unique | Same |
| Partial unique (`WHERE …`) | partial unique index | generated column + unique | e.g. soft-delete uniqueness |
| GIN / full-text indexes | GIN / `to_tsvector` | **no fake equivalent in v1** | Keep PG path; MySQL uses LIKE / app filter |
| Cascading FKs | supported | supported | Same |
| Materialized views | `MATERIALIZED VIEW` | ordinary `VIEW` | `usage_records_daily_mv` → non-materialized VIEW |

## Tables in scope (42 + 1 view)

Physical table list is produced by `pnpm --filter @agenticx/enterprise exec tsx scripts/db-compat/list-schema-capabilities.ts`.

Critical view:

| Name | PostgreSQL | MySQL |
|---|---|---|
| `usage_records_daily_mv` | materialized view | ordinary VIEW with same name |

## Migration inventory rules

- PostgreSQL journal entries: **28** (do not renumber / delete published entries).
- Disk SQL files under `packages/db-schema/drizzle/`: **30**.
- **Do not port** these orphan / duplicate files into MySQL:
  - `0016_mcp_hosting.sql` (duplicate number; not in journal)
  - `0025_enterprise_runtime_mcp_servers.sql` (orphan; superseded by later journal entry)
- MySQL migrations live under `packages/db-schema/drizzle-mysql/` and must mirror the **28 journal entries only**.

## Out of scope for v1

- CDC / dual-write online cutover
- Fake GIN / tsvector parity on MySQL
- Dropping PostgreSQL support
