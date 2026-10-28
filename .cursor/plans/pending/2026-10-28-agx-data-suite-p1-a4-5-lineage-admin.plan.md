# AGX Data Suite P1-A4-5 — Lightweight Lineage + Admin 数据治理 Stub

> **Parent index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-index.plan.md`
> Execute only after A4-4 Done criteria pass.

**Goal:** Build a **table-level** lineage graph from P0 `LineageLog` events, and add an admin-console **数据治理** stub page that lists dictionary fields (read-only). Field-level SQL parsing is progressive/out of scope for this slice.

**Architecture:**
- Library: `agenticx/data_suite/governance/lineage_graph.py` builds nodes/edges from job lineage events (`node_id`, inputs/outputs table names in meta).
- Enterprise: add sidebar entry + `/admin/data-governance` page listing dictionary JSON from a checked-in sample YAML (or filesystem path via env). Keep UI minimal — no full CRUD yet.

**Tech Stack:** Python 3.10+, pytest; Next.js admin-console.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/governance/lineage_graph.py` | Graph from LineageLog |
| `tests/data_suite/test_governance_lineage_graph.py` | Graph shape tests |
| `enterprise/apps/admin-console/src/app/admin/data-governance/page.tsx` | Stub list UI |
| Admin sidebar / AppShell nav entry | Link to 数据治理 |

### Task 1: Lineage graph from LineageLog

- [ ] Given events with `meta.tables_in` / `meta.tables_out`, produce unique nodes + directed edges.
- [ ] Commit: `feat(data-suite): table-level lineage graph from job lineage logs`

### Task 2: Admin stub page + nav

- [ ] Add 数据治理 nav next to existing sections.
- [ ] Page renders field name + owner + update_freq from sample dictionary (static import or fetch).
- [ ] Smoke: typecheck/build for touched admin files.
- [ ] Commit: `feat(admin): data governance stub page listing dictionary fields`

## Done criteria (closes A4)

- [ ] Lineage graph pytest green
- [ ] Admin stub reachable in local admin-console
- [ ] A4-1…A4-5 all Done → update P1 index status
