# AGX Rules & Knowledge P2 — K3 GraphDB Index (Publish Target / Source of Truth)

> **Parent:** K3 spine on `main` (`agenticx/knowledge/graphers/incremental/`, tip ~`f3e59216`).
> **Depends on:** K3 library + admin sync-runs UI already merged.
> Execute sequentially: G1 → G5. No parallel sub-agents. No A9. Brand-A / synthetic only. Desensitize. Leave unrelated dirty untouched. **Local Mac only** (cloud agents region-blocked). **Do NOT build visualization UI in this PR.**

**Goal:** Make a pluggable **graph database store** the publish target and source of truth for K3 incremental sync. File/JSON `KnowledgeGraph` must not remain production truth; Neo4j is the default backend when configured; incremental publish does MERGE upsert / retire, not only full clear+export.

**Why now:** Current K3 `merge_published_into_graph` lands in an in-memory / file-serialized `KnowledgeGraph`. `Neo4jExporter` is full-export (clear tenant → CREATE). Product wants GraphStore as SoT so visualization (later) and admin can query the DB, not a JSON snapshot.

**Assumptions:**
1. `GraphStore` protocol: upsert entities/relations, delete/retire, get by id, stats (+ backend name).
2. Default backend = Neo4j when `NEO4J_URI` (and creds) present; otherwise `InMemoryGraphStore` for unit tests / local without Neo4j.
3. `FileGraphStore` (JSON) exists only for tests / offline fixtures — documented as non-production.
4. Reuse `neo4j_exporter.py` sanitization / connection patterns; add incremental MERGE (not clear+export-only).
5. Wire `IncrementalGraphSync` so published lifecycle objects upsert into GraphStore; retired objects delete/retire in store; `SyncReport.graph_stats` includes store backend + counts.
6. Live Neo4j tests skip cleanly without `NEO4J_URI` (pytest.mark.skipif). Optional mock-driver unit path covers Cypher shapes without a server.
7. Admin: optional status note / `store_backend` in sync report stats only — **no viz UI**.
8. Branch: `feat/agx-rules-knowledge-p2-k3-graphdb` from `origin/main`. Commit + push + open PR; do **not** squash-merge.

**A/B boundary:**
- **In (A):** `agenticx/knowledge/graphers/store/` (or `graph_store.py` + neo4j backend), K3 publish/sync wiring, tests, README.
- **Out (B):** Graph visualization UI, domain ontology, live customer data, A9.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| G1 | `…-k3-graphdb-1-store-protocol.plan.md` | GraphStore protocol + InMemory (+ File for tests) + unit tests green |
| G2 | `…-k3-graphdb-2-neo4j-backend.plan.md` | Neo4jGraphStore incremental MERGE upsert/delete/stats; skipif live tests |
| G3 | `…-k3-graphdb-3-wire-publish.plan.md` | IncrementalGraphSync publish → store; SyncReport store stats; retire deletes |
| G4 | `…-k3-graphdb-4-e2e.plan.md` | Fake-store e2e + optional NEO4J_URI live; CI skips live cleanly |
| G5 | `…-k3-graphdb-5-admin-readme.plan.md` | Admin note / store_backend in stats; README how-to; index Done; PR open |

## E2E gate

1. `pytest tests/knowledge/graphers/ -q -k 'store or incremental or graphdb or neo4j'` green (live Neo4j skipped unless env set).
2. With `auto_publish=True` and an InMemory/Neo4j store: published entities land in store; retire removes/marks them; SyncReport includes `store_backend` + counts.
3. No viz UI; Brand-A / synthetic only.

## Branch

`feat/agx-rules-knowledge-p2-k3-graphdb` ← `origin/main` (~`f3e59216`).

## Status

- **Plans:** Done (G1–G5)
- **Impl:** Done on `feat/agx-rules-knowledge-p2-k3-graphdb`
- **Viz:** deferred (do not start in this PR)
