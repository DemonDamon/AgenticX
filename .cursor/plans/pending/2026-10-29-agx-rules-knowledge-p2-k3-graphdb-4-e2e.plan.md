# K3-GraphDB G4 — E2E with fake store (+ optional live Neo4j)

> **Parent:** index · **Depends on:** G3

**Goal:** Closed-loop e2e proving GraphStore is the publish target. CI without Neo4j stays green via skip.

## File map

| Path | Responsibility |
|------|----------------|
| `tests/knowledge/graphers/incremental/test_sync_graph_store_e2e.py` | Fake GraphStore e2e |
| `tests/knowledge/graphers/store/test_neo4j_store.py` | Live skipif path (from G2) |

### Tasks

- [x] E2E: sync with auto_publish → entities in fake store; change/remove source → upsert/delete reflected; SyncReport store stats
- [x] Document: set `NEO4J_URI=bolt://localhost:7687` (+ user/pass) to run live Neo4j tests
- [x] Commit: `test(knowledge): K3 GraphStore publish e2e`

## Status

Done
