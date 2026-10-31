# GraphStore — recommended read facade

This package is the **publish source of truth** for K3 knowledge graphs
(`Neo4jGraphStore` in production; `memory` / `file` for tests and offline
fixtures only).

## Sole recommended read surface

Callers (agents, admin bridges, managed templates, SDKs) **must** read the
graph through the `GraphStore` Protocol helpers — not by opening a backend
driver, issuing ad-hoc Cypher/SQL, or parsing store files directly.

| Method | Purpose | Shape |
|--------|---------|--------|
| `neighborhood(entity_id, *, depth=1, limit=200)` | BFS hops around a center | `{center_id, nodes, edges}` |
| `subgraph(*, entity_ids=None, limit_nodes=200)` | Capped export / filter by ids | `{nodes, edges, stats}` |

Shared pure helpers live in `query.py` (`build_neighborhood` /
`build_subgraph`). Backends (`memory`, `file`, `neo4j`) and the admin
`query_cli` bridge all route through the same Protocol methods so the read
contract stays one surface.

### Do / Don't

- **Do** obtain a store via `create_graph_store(...)` (or inject a
  `GraphStore`-compatible test double) and call `neighborhood` / `subgraph`.
- **Do** use `list_entities` / `list_relationships` / `get_*` for point
  lookups and capped listings when a neighborhood is not needed.
- **Don't** import a backend driver client in product code to bypass the
  Protocol.
- **Don't** treat file/JSON dumps as a second production SoT.

## Write path note

Incremental publish upserts via `publish_to_store` in
`agenticx.knowledge.graphers.incremental.publish`. Primary upsert
success/failure is reported with `ok` / `primary_failures`; secondary
side-effect failures (for example optional stats or hooks) are listed under
`warnings` and **must not** flip `ok` when the primary upserts succeeded.
