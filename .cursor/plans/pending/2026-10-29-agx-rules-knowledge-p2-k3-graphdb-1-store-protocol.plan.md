# K3-GraphDB G1 — GraphStore protocol + in-memory/file backends

> **Parent:** `2026-10-29-agx-rules-knowledge-p2-k3-graphdb-index.plan.md`

**Goal:** Introduce pluggable `GraphStore` so K3 publish does not depend on `KnowledgeGraph` JSON as production SoT. Ship InMemory (tests/default offline) and File (test fixture only, documented non-prod).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/store/__init__.py` | Public exports |
| `agenticx/knowledge/graphers/store/protocol.py` | GraphStore Protocol + GraphStoreStats |
| `agenticx/knowledge/graphers/store/memory.py` | InMemoryGraphStore |
| `agenticx/knowledge/graphers/store/file.py` | FileGraphStore (JSON; tests only) |
| `tests/knowledge/graphers/store/test_memory_store.py` | Unit tests |

## Interfaces

```python
class GraphStore(Protocol):
    @property
    def backend_name(self) -> str: ...
    def upsert_entity(self, entity: Entity) -> None: ...
    def upsert_relationship(self, relationship: Relationship) -> None: ...
    def delete_entity(self, entity_id: str) -> bool: ...
    def delete_relationship(self, relationship_id: str) -> bool: ...
    def get_entity(self, entity_id: str) -> Optional[Entity]: ...
    def get_relationship(self, relationship_id: str) -> Optional[Relationship]: ...
    def stats(self) -> Dict[str, Any]:  # entity_count, relationship_count, backend
```

### Tasks

- [x] Protocol + InMemory + File backends
- [x] Unit tests: upsert/get/delete/stats; File round-trip
- [x] Commit: `feat(knowledge): add pluggable GraphStore protocol + memory/file backends`

## Status

Done
