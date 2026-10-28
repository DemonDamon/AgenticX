# AGX Data Suite P1-A6 — Dashboard Framework Index

> **Parent:** `.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`
> **P1 index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-index.plan.md`
> Execute only after A5 Done. Sequential A6-1 → A6-2 → A6-3 → A6-4.

**Goal:** Ship a config-driven BI board framework so one business board is produced entirely from YAML (no bespoke frontend), with drill-down and compare views — A-layer only.

**Architecture:** Library first under `agenticx/data_suite/dashboard/` (BoardSpec → DatasetBinder → Drill/Compare). Enterprise surface in **admin-console** `/admin/data-boards` (reuses `@agenticx/ui` ChartCard/BarCard/LineCard already in admin; web-portal can host the same renderer later). Sample board fixtures are industry-agnostic.

**Tech Stack:** Python 3.10+, pytest, PyYAML; Next.js admin-console + Vitest; local browser smoke for e2e.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| A6-1 | `2026-10-28-agx-data-suite-p1-a6-1-board-spec.plan.md` | YAML board load; widgets + layout grid; unknown chart type rejected |
| A6-2 | `2026-10-28-agx-data-suite-p1-a6-2-dataset-binder.plan.md` | In-memory binder: filter / group / metric → chart series |
| A6-3 | `2026-10-28-agx-data-suite-p1-a6-3-drill-compare.plan.md` | Drill path + compare window over binder queries |
| A6-4 | `2026-10-28-agx-data-suite-p1-a6-4-admin-e2e.plan.md` | Admin data-boards page from fixture; vitest + browser e2e green |

## E2E gate (whole A6)

1. `pytest tests/data_suite/test_dashboard_*.py` green.
2. Admin vitest for data-boards section + platform section registration.
3. Browser smoke: login → `/admin/data-boards` → see sample board title + ≥1 chart series from fixture; click drill control updates series; compare toggle shows two series.

## Status

- **A6:** done on `feat/agx-data-suite-p1-a6` (spec/binder/explore + admin data-boards; pytest + playwright e2e green).
