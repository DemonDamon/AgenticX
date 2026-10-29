# AGX Rules & Knowledge P2 — K3-4 Review trail + publish into graph

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p2-k3-index.plan.md`
> **Depends on:** K3-3

**Goal:** Drive K2 review transitions (draft → pending_review → published) with ChangeTrailStore audit, then merge **published** objects into `KnowledgeGraph` (Entity / Relationship). Un-published objects must not appear in the graph.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/incremental/publish.py` | submit_for_review, publish_objects, merge_published_into_graph |
| `tests/knowledge/graphers/incremental/test_publish.py` | Trail + graph membership gating |

## Interfaces

```python
def submit_for_review(store: KnowledgeObjectFileStore, object_ids: list[str]) -> list[KnowledgeObject]: ...
def publish_objects(store: KnowledgeObjectFileStore, object_ids: list[str]) -> list[KnowledgeObject]: ...

def merge_published_into_graph(
    store: KnowledgeObjectFileStore,
    graph: KnowledgeGraph,
    *,
    object_ids: list[str] | None = None,
) -> dict:  # stats: entities_added, relations_added, skipped
    """Only objects with status==published are merged. Entities before relations."""
```

Conversion:
- kind=entity → `Entity(id=..., name=attrs["name"], entity_type=..., source_chunks=set(source_ids))`
- kind=relation → `Relationship(id=..., source_entity_id=..., target_entity_id=..., relation_type=..., source_chunks=...)`

### Task 1

- [x] Tests: draft not merged; after publish, entity present; trail has transition events; illegal transition still raises via K2.
- [x] Commit: `feat(knowledge): graph incremental review publish into KnowledgeGraph`

## Status

Done on `feat/agx-rules-knowledge-p2-k3` (K3-4).
