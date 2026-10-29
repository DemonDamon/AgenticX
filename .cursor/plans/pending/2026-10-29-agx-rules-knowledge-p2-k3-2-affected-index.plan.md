# AGX Rules & Knowledge P2 — K3-2 Affected object index

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p2-k3-index.plan.md`
> **Depends on:** K3-1

**Goal:** Map source_id → knowledge object ids so a ChangeSet yields the set of affected objects (and sources that must be re-extracted) without scanning the whole graph.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/incremental/index.py` | SourceObjectIndex + resolve_affected |
| `tests/knowledge/graphers/incremental/test_index.py` | Link/unlink, resolve added/changed/removed |

## Interfaces

```python
@dataclass
class AffectedSet:
    source_ids: list[str]          # needs_extract from ChangeSet
    object_ids: list[str]          # objects linked to added/changed/removed sources
    retire_candidates: list[str]   # objects whose sources are all removed / empty after update

class SourceObjectIndex:
    def link(self, source_id: str, object_id: str) -> None: ...
    def unlink(self, source_id: str, object_id: str) -> None: ...
    def replace_links(self, source_id: str, object_ids: list[str]) -> None: ...
    def objects_for(self, source_id: str) -> list[str]: ...
    def sources_for(self, object_id: str) -> list[str]: ...
    def resolve_affected(self, change: ChangeSet) -> AffectedSet: ...
```

Persist `source_index.json` under same incremental store root.

### Task 1

- [x] Tests: changed source returns its linked objects; removed source marks retire_candidates when no remaining sources; added source has empty object_ids until extract.
- [x] Implement + green.
- [x] Commit: `feat(knowledge): graph incremental source-object index`

## Status

Done on `feat/agx-rules-knowledge-p2-k3` (K3-2).
