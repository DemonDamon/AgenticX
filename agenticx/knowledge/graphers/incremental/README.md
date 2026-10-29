# Graph incremental sync (K3)

Reusable A-layer spine for **图谱增量更新与审核留痕**.

## Pipeline

1. **Fingerprint** sources (`SourceChangeTracker`) → `ChangeSet` (added / changed / removed / unchanged).
2. **Resolve affected** objects via `SourceObjectIndex` (skip full rebuild).
3. **Extract** only `needs_extract` sources through a pluggable `Extractor` into K2 lifecycle **drafts**.
4. **Review / publish** via K2 status machine + `ChangeTrailStore`.
5. **Publish** into pluggable **`GraphStore`** (Neo4j default when `NEO4J_URI` is set; in-memory/file only for tests). Optional mirror into in-process `KnowledgeGraph` for backward compatibility — **file/JSON is not production SoT**.

## Synthetic sample (no domain ontology / no LLM)

```python
from agenticx.knowledge.graphers.incremental import (
    IncrementalGraphSync,
    SourceDocument,
    ExtractedEntity,
    ExtractedGraph,
    ExtractedRelation,
)

class MockExtractor:
    def extract(self, doc):
        # Deterministic demo extraction keyed by source id
        eid = f"ent-{doc.id}"
        return ExtractedGraph(
            entities=[ExtractedEntity(id=eid, name=f"Sample-{doc.id}", source_id=doc.id)],
            relations=[],
        )

sync = IncrementalGraphSync("/tmp/k3-demo", extractor=MockExtractor(), auto_publish=True)
r1 = sync.sync([SourceDocument(id="doc-a", content="alpha")])
r2 = sync.sync([
    SourceDocument(id="doc-a", content="alpha"),           # unchanged → skipped
    SourceDocument(id="doc-b", content="bravo"),           # added
])
assert "doc-a" in r2.unchanged
assert r2.extracted_source_ids == ["doc-b"]
```

Admin UI: `/admin/graph-incremental` in `enterprise/apps/admin-console` (store/API under `graph-incremental-*`, e2e `enterprise/scripts/e2e-graph-incremental.ts`). This package remains the library spine.

## GraphStore (publish source of truth)

K3 incremental publish writes lifecycle-published entities/relations into a
`GraphStore` backend:

| Backend | When | Production? |
|---------|------|-------------|
| `Neo4jGraphStore` | `NEO4J_URI` set or `create_graph_store("neo4j")` | **Yes** (default) |
| `InMemoryGraphStore` | tests / no Neo4j | No (ephemeral) |
| `FileGraphStore` | offline fixtures only | **No** — do not use as SoT |

```python
from agenticx.knowledge.graphers.store import create_graph_store, InMemoryGraphStore
from agenticx.knowledge.graphers.incremental import IncrementalGraphSync, SourceDocument

store = InMemoryGraphStore()  # or create_graph_store() → Neo4j when NEO4J_URI set
sync = IncrementalGraphSync(
    "/tmp/k3-demo",
    extractor=MockExtractor(),
    auto_publish=True,
    graph_store=store,
)
report = sync.sync([SourceDocument(id="doc-a", content="alpha")])
assert report.graph_stats["store_backend"] == "memory"
assert store.get_entity("ent-doc-a") is not None
```

### Point at local Neo4j

```bash
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j          # or NEO4J_USERNAME
export NEO4J_PASSWORD=password
export NEO4J_DATABASE=neo4j      # optional
export NEO4J_TENANT_ID=brand-a   # optional multi-tenant property scope

# Live store tests (skipped in CI without NEO4J_URI):
pytest tests/knowledge/graphers/store/test_neo4j_store.py -q --no-cov
```

Incremental upserts use `MERGE` by id (no full clear+export). Retired lifecycle
objects are deleted from the store. `SyncReport.graph_stats` includes
`store_backend`, counts, and optional `retire` stats.

### Visualization (deferred)

Graph visualization UI is **out of scope** for this change. Admin
`/admin/graph-incremental` continues to show sync runs; store backend appears in
report `graph_stats` when present. Viz should read from Neo4j / GraphStore next.
