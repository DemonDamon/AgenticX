# K3-GraphDB G2 — Neo4j backend (incremental MERGE)

> **Parent:** index · **Depends on:** G1

**Goal:** `Neo4jGraphStore` as default production backend. Reuse exporter sanitization / driver patterns. Incremental MERGE upsert (not clear+export only). delete/retire by id. Live tests skip without `NEO4J_URI`.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/store/neo4j_store.py` | Neo4jGraphStore |
| `agenticx/knowledge/graphers/store/factory.py` | `create_graph_store()` from env / config |
| `tests/knowledge/graphers/store/test_neo4j_store.py` | Mock-driver unit + skipif live |

## Env (documented)

- `NEO4J_URI` (e.g. `bolt://localhost:7687`) — required for live
- `NEO4J_USER` / `NEO4J_USERNAME` (default `neo4j`)
- `NEO4J_PASSWORD` (default `password`)
- `NEO4J_DATABASE` (default `neo4j`)
- optional `NEO4J_TENANT_ID` for multi-tenant property scoping

### Tasks

- [x] Neo4jGraphStore: connect, MERGE entity by id, MERGE rel by id, delete, get, stats
- [x] factory: Neo4j if URI set else InMemory
- [x] Tests: mock session unit; `@pytest.mark.skipif(not os.getenv("NEO4J_URI"))` live
- [x] Commit: `feat(knowledge): Neo4jGraphStore incremental MERGE backend`

## Status

Done
