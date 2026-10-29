# K3-GraphDB G3 — Wire K3 publish → GraphStore

> **Parent:** index · **Depends on:** G2

**Goal:** Published lifecycle objects land in GraphStore; retired objects delete/retire in store; SyncReport includes store stats. Keep KnowledgeGraph mirror optional for backward compat (not SoT).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/incremental/publish.py` | `publish_to_store` / extend merge path |
| `agenticx/knowledge/graphers/incremental/sync.py` | Accept `graph_store`; wire auto_publish + retire |
| `agenticx/knowledge/graphers/incremental/__init__.py` | Re-exports |
| `tests/knowledge/graphers/incremental/test_publish_store.py` | Fake store assertions |

### Tasks

- [x] `publish_to_store(store_objs, graph_store)` upserts entities then relations
- [x] On retire in sync: `delete_entity` / `delete_relationship` by kind
- [x] SyncReport.graph_stats includes store_backend, entity_count, relationship_count, upserts/deletes
- [x] Existing KnowledgeGraph merge remains when graph_store is None or as optional mirror — document that GraphStore is SoT when provided
- [x] Commit: `feat(knowledge): wire K3 incremental publish into GraphStore`

## Status

Done
