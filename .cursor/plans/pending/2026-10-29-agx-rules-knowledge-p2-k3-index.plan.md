# AGX Rules & Knowledge P2 — K3 Index (Graph Incremental Sync + Review Trail)

> **Parent roadmap:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md`
> **Depends on:** K2 lifecycle on `main` (`agenticx/knowledge/lifecycle/`, tip includes P0 debt `ebe36853`). Requirement background: `docs/agx-rules-knowledge-suite/requirement-background.md`.
> Execute sequentially: K3-1 → K3-5. No parallel sub-agents. No A9 compute. Do not invent customer/company names. Leave unrelated dirty files untouched. Local only.

**Goal:** Land P2 capability **K3 图谱增量更新与审核留痕** as a reusable A-layer spine under `agenticx/knowledge/graphers/incremental/`: source fingerprint + change detection, affected-object resolution (skip full rebuild), extract → K2 lifecycle draft/review trail → publish into `KnowledgeGraph`, with a closed-loop e2e proving only changed sources are reprocessed and the process is auditable.

**What K3 means (per suite plan):**
- Incremental sync (periodic or event-driven): identify affected objects; avoid full reprocessing
- Standard pipeline: extract → review trail → publish into graph
- Link with K2 lifecycle (`KnowledgeObject` status machine + `ChangeTrailStore`)
- Landing: extend `agenticx/knowledge/graphers/` (new `incremental/` subpackage; do not rewrite SPO/LLM builder)
- Acceptance: after changing a batch of source docs, graph only incrementally updates affected objects; process is traceable

**Assumptions (suite plan is capability-level; these make slices executable):**
1. Existing `KnowledgeGraphBuilder.build_incremental` only appends texts with LLM SPO — K3 adds change detection + review gate + K2 linkage without requiring LLM in unit/e2e tests.
2. Extractor is a pluggable protocol; tests use a deterministic mock (no network / no A9).
3. Persistence: JSON under resolve root / env `AGX_GRAPH_INCREMENTAL_STORE_DIR` / `.runtime/graph-incremental`.
4. Admin UI is **out of K3-1…K3-5** (library + e2e first). A later admin slice may mirror this if product asks.
5. Graph publish merges **published** lifecycle objects into an in-memory / file-serialized `KnowledgeGraph`; Neo4j export remains optional and out of e2e.

**A/B boundary:**
- **In AgenticX (A):** `agenticx/knowledge/graphers/incremental/` models/stores/sync; synthetic fixtures under `tests/knowledge/graphers/incremental/`.
- **Out (B):** domain ontology, industry dictionaries, source-system adapters, real customer identifiers, live Neo4j, LLM extraction backends.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| K3-1 | `2026-10-29-agx-rules-knowledge-p2-k3-1-source-tracker.plan.md` | SourceDocument + content hash + SourceChangeTracker + ChangeSet + unit tests green |
| K3-2 | `2026-10-29-agx-rules-knowledge-p2-k3-2-affected-index.plan.md` | SourceObjectIndex + resolve_affected + tests |
| K3-3 | `2026-10-29-agx-rules-knowledge-p2-k3-3-extract-lifecycle.plan.md` | Extractor protocol + apply drafts into K2 store + tests (mock extractor) |
| K3-4 | `2026-10-29-agx-rules-knowledge-p2-k3-4-review-publish.plan.md` | Review transitions + publish published objects into KnowledgeGraph + trail assertions |
| K3-5 | `2026-10-29-agx-rules-knowledge-p2-k3-5-sync-e2e.plan.md` | IncrementalGraphSync orchestrator + SyncReport + closed-loop e2e + README; index complete |

## E2E gate (whole K3)

1. `pytest tests/knowledge/graphers/incremental/ -q` green.
2. Sample path: ingest sources → sync → change one source → sync again → only affected objects re-extracted / updated; unchanged sources skipped; K2 trail + SyncReport present; published entities appear in graph.
3. No real customer / company / proposal identifiers under `agenticx/knowledge/graphers/incremental/` or fixtures.

## Branch

`feat/agx-rules-knowledge-p2-k3` from latest `main` (tip ~`ebe36853`).

## Status

- **Plans:** all K3 slices Done
- **Impl:** K3-1…K3-5 on `feat/agx-rules-knowledge-p2-k3` (library + e2e; admin deferred)
- **Admin UI:** deferred (library + e2e first)
