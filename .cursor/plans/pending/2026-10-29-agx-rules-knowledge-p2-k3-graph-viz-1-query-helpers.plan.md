# K3-GraphViz V1 — GraphStore query helpers

> **Parent:** index · **Depends on:** #158 GraphStore protocol

**Goal:** Extend GraphStore so UI can list neighborhood / subgraph / entities without treating JSON snapshots as SoT.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/store/protocol.py` | Add `list_entities`, `list_relationships`, `neighborhood`, `subgraph` |
| `agenticx/knowledge/graphers/store/memory.py` | Implement helpers |
| `agenticx/knowledge/graphers/store/file.py` | Delegate to memory |
| `agenticx/knowledge/graphers/store/neo4j_store.py` | Cypher implementations |
| `agenticx/knowledge/graphers/store/query.py` | Shared neighborhood/subgraph pure helpers for dict stores |
| `tests/knowledge/graphers/store/test_query_helpers.py` | Unit tests |

## Interfaces

```python
def list_entities(self, *, limit: int = 500) -> List[Entity]: ...
def list_relationships(self, *, limit: int = 1000) -> List[Relationship]: ...
def neighborhood(self, entity_id: str, *, depth: int = 1, limit: int = 200) -> Dict[str, Any]:
    # { "nodes": [...entity dicts], "edges": [...rel dicts], "center_id": str }
def subgraph(self, *, entity_ids: Optional[List[str]] = None, limit_nodes: int = 200) -> Dict[str, Any]:
    # { "nodes": [...], "edges": [...], "stats": {...} }
```

### Tasks

- [x] Protocol + memory/file/neo4j implementations
- [x] pytest: Brand-A-ish tiny graph neighborhood + subgraph + limits
- [x] Commit: `feat(knowledge): GraphStore query helpers for explorer UI`

## Status

Done
