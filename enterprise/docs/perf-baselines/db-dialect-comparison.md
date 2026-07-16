# DB Dialect Performance Comparison

Internal regression gate for Enterprise dual-dialect support.

## Rule

Under the same CI / lab fixture, if MySQL P95 for DB-heavy admin/portal APIs
degrades by **more than 20%** relative to PostgreSQL, block the release and
investigate. This is **not** a customer SLA.

## How to capture

1. Start infra for each dialect:
   - `bash scripts/start-dev-with-infra.sh --db=postgresql --infra-only`
   - `bash scripts/start-dev-with-infra.sh --db=mysql --infra-only`
2. `pnpm --filter @agenticx/db-schema db:migrate && db:seed`
3. Run a fixed set of DB-heavy endpoints (IAM user list, audit query, metering heatmap, MCP latency p50).
4. Record P50/P95 in this file per release candidate.

## Baseline template

| API | PG P50 | PG P95 | MySQL P50 | MySQL P95 | Δ P95 | Status |
|---|---|---|---|---|---|---|
| GET /api/admin/users | TBD | TBD | TBD | TBD | TBD | pending |
| GET audit events | TBD | TBD | TBD | TBD | TBD | pending |
| Metering heatmap | TBD | TBD | TBD | TBD | TBD | pending |

Fill after first dual-matrix CI green run.
