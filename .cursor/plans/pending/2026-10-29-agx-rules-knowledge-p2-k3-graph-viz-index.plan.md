# AGX Rules & Knowledge P2 — K3 Graph Visualization Index

> **Depends on:** PR #158 `feat/agx-rules-knowledge-p2-k3-graphdb` @ `106aa2d4` (GraphStore SoT). Stack on that branch unless already merged to main.
> Execute sequentially: V1 → V5. No parallel. No A9. Brand-A / synthetic only. Desensitize. Leave unrelated dirty untouched. **Local Mac only.** Do **not** squash-merge.

**Goal:** Admin **graph explore view** that queries **GraphStore** (Neo4j when configured; InMemory/File for local demo) — not ad-hoc JSON snapshots as graph truth. In-browser force-directed canvas; click node for attrs; show backend label (`neo4j|memory|file`).

**Why now:** #158 made GraphStore the publish SoT but deferred viz. Product needs an in-admin explorer; linking only to Neo4j Browser is insufficient for A-layer UX.

**Assumptions:**
1. Extend GraphStore with query helpers used by UI: `list_entities`, `list_relationships`, `neighborhood`, `subgraph` (+ existing `stats` / `get_*`).
2. Admin read APIs go through a GraphStore-shaped layer (TS memory/file for local; Neo4j via env / Python bridge when `NEO4J_URI` set).
3. Brand-A seed upserts entities/relations into GraphStore; explorer reads store — not `graph_stats.json` alone.
4. Reduce #158 debt: admin sync demo must label `store_backend` and not pretend JSON is graph SoT.
5. Playwright HD shots continue numbering **17+**; vitest for store/API helpers.
6. Branch: `feat/agx-rules-knowledge-p2-k3-graph-viz` ← `feat/agx-rules-knowledge-p2-k3-graphdb` (stacked PR OK).

**A/B boundary:**
- **In (A):** GraphStore query helpers, admin `/admin/graph-explorer` (+ APIs), Brand-A seed into store, e2e shots, incremental SoT display alignment.
- **Out (B):** Domain ontology / customer data, replacing Neo4j, Feishu manual refresh (unless one-liner), portal viz (optional later).

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| V1 | `…-graph-viz-1-query-helpers.plan.md` | Protocol + memory/file/neo4j query helpers + pytest green |
| V2 | `…-graph-viz-2-admin-store-api.plan.md` | Admin GraphStore read layer + Brand-A seed + `/api/admin/graph-explorer/*` |
| V3 | `…-graph-viz-3-ui-canvas.plan.md` | `/admin/graph-explorer` force canvas + node attrs + backend badge + nav/i18n |
| V4 | `…-graph-viz-4-incremental-sot-align.plan.md` | graph-incremental seed/sync shows GraphStore backend/stats honestly |
| V5 | `…-graph-viz-5-e2e-pr.plan.md` | vitest + Playwright shots 17+ + README + push stacked PR |

## E2E gate

1. `pytest tests/knowledge/graphers/store/ -q` green (live Neo4j skipif).
2. Admin explorer: seed → nodes/edges render; click node shows attrs; backend badge visible.
3. Shots 17+ under `docs/agx-rules-knowledge-suite/e2e-shots/`; MD5s distinct.
4. Brand-A / synthetic only.

## Branch

`feat/agx-rules-knowledge-p2-k3-graph-viz` ← `feat/agx-rules-knowledge-p2-k3-graphdb` (`106aa2d4`).

## Status

- **Plans:** Done (V1–V5 written)
- **Impl:** In progress
