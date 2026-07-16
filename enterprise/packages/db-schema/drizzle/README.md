# PostgreSQL Drizzle migrations

This folder is the **PostgreSQL-only** migration chain for Enterprise.

## Inventory (do not break)

| Item | Count / rule |
|---|---|
| Journal entries (`meta/_journal.json`) | **29** — published; never renumber or delete |
| SQL files on disk | **31** |
| Orphan / duplicate (do **not** port to MySQL) | `0016_mcp_hosting.sql`, `0025_enterprise_runtime_mcp_servers.sql` |

## MySQL counterpart

MySQL migrations live in sibling folder:

```text
packages/db-schema/drizzle-mysql/
```

MySQL journal must contain exactly the **28** journal-tracked migrations (not the two orphan files).

## Switching dialect

Use env:

```bash
DATABASE_DIALECT=postgresql   # default
# or
DATABASE_DIALECT=mysql
DATABASE_URL=...
```

See `enterprise/docs/database/dialect-compatibility-matrix.md`.
