# AGX Data Suite P1-A5 — Tag & Audience Index

> **Parent:** `.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`
> **P1 index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-index.plan.md`
> Execute only after A4 Done. Sequential A5-1 → A5-2 → A5-3.

**Goal:** Ship config-driven tag metamodel + compute + audience circle-select DSL so projects can define→compute→圈选 without engine forks (首期窄集合跑通，滚动扩展零引擎改动).

**Architecture:** `agenticx/data_suite/tags/` + `agenticx/data_suite/audience/`. Tags reuse dictionary four-elements pattern; compute runs offline on in-memory rows first (SQL/UDF pushdown later). Audience DSL compiles to predicate over tag values.

**Tech Stack:** Python 3.10+, pytest, PyYAML.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| A5-1 | `2026-10-28-agx-data-suite-p1-a5-1-tag-catalog.plan.md` | Tag catalog YAML load; layer + four elements; duplicate-name conflict detection |
| A5-2 | `2026-10-28-agx-data-suite-p1-a5-2-tag-compute.plan.md` | Compute engine applies expression tags to row batches; lineage meta recorded |
| A5-3 | `2026-10-28-agx-data-suite-p1-a5-3-audience.plan.md` | Audience DSL AND/OR/NOT over tag predicates returns matching ids |

## Status

- **A5:** done on `feat/agx-data-suite-p1-a4` (catalog + compute + audience; pytest green).
