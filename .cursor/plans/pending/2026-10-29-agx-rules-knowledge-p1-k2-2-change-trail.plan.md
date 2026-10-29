# AGX Rules & Knowledge P1 — K2-2 Change / audit trail

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-k2-index.plan.md`
> **Depends on:** K2-1

**Goal:** Append-only change trail for knowledge objects (create / update / transition / retire) so 「变更追溯」and later review/RBAC hooks have a durable record. Actor is a free-form string (no auth stack in this slice).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/lifecycle/trail.py` | ChangeEvent + ChangeTrailStore |
| `agenticx/knowledge/lifecycle/store.py` | Optional trail hook on upsert/transition |
| `tests/knowledge/lifecycle/test_change_trail.py` | Append, list-by-object, persist reload |

## Interfaces

```python
@dataclass
class ChangeEvent:
    id: str
    object_id: str
    action: str          # create|update|transition|retire|reopen
    actor: str = "system"
    from_status: str | None = None
    to_status: str | None = None
    detail: dict = field(default_factory=dict)
    at: str = ""

class ChangeTrailStore:
    def append(self, event: ChangeEvent) -> ChangeEvent: ...
    def list_for(self, object_id: str) -> list[ChangeEvent]: ...
    def list_all(self) -> list[ChangeEvent]: ...
```

### Task 1

- [x] Trail file `changes.jsonl` or `changes.json` under same store root.
- [x] Store transitions optionally record events when trail injected.
- [x] Commit: `feat(knowledge): knowledge object change trail`

## Status

Done on `feat/agx-rules-knowledge-p1-k2`.
