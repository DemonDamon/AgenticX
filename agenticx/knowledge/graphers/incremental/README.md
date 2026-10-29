# Graph incremental sync (K3)

Reusable A-layer spine for **图谱增量更新与审核留痕**.

## Pipeline

1. **Fingerprint** sources (`SourceChangeTracker`) → `ChangeSet` (added / changed / removed / unchanged).
2. **Resolve affected** objects via `SourceObjectIndex` (skip full rebuild).
3. **Extract** only `needs_extract` sources through a pluggable `Extractor` into K2 lifecycle **drafts**.
4. **Review / publish** via K2 status machine + `ChangeTrailStore`.
5. **Merge** published objects into `KnowledgeGraph`.

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

Admin UI is deferred; this package is the library spine.
