# AGX Rules & Knowledge P1 — R2-4 Retrieval object disambiguation adapter

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-r2-index.plan.md`
> **Depends on:** R2-1, R2-2; existing `agenticx/retrieval/` (provenance/evidence OK)

**Goal:** When object lookup returns multiple hits (same alias / near scores) or conflicting provenance values, emit the same DisambiguationRequest types; resolve to a single object id + optional evidence note.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/retrieval/disambiguation.py` | `object_hits_to_request`, `conflicts_to_request`, `resolve_object_hits` |
| `tests/retrieval/test_object_disambiguation.py` | Multi-hit select; conflict resolve; single-hit no-op |

## Interfaces

```python
@dataclass
class ObjectHit:
    id: str
    label: str
    score: float | None = None
    attrs: dict = field(default_factory=dict)
    sources: list[str] = field(default_factory=list)

def needs_object_disambiguation(hits: list[ObjectHit], *, score_margin: float = 0.05) -> bool:
    """True when ≥2 hits and top scores within margin (or identical labels)."""

def object_hits_to_request(hits: list[ObjectHit], *, prompt: str = "", session_id: str = "") -> DisambiguationRequest:
    """Mode candidate_select."""

def attribute_conflicts_to_request(
    field: str,
    values_by_source: dict[str, Any],
    *,
    session_id: str = "",
) -> DisambiguationRequest:
    """Mode conflict_resolve; candidates encode source::value picks."""

def resolve_object_hits(
    hits: list[ObjectHit],
    *,
    gate: DisambiguationGate | None = None,
    store: DisambiguationFileStore | None = None,
    score_margin: float = 0.05,
) -> tuple[ObjectHit | None, DisambiguationSession | None]:
    """Single clear hit → return it, no session. Else open session / gate."""
```

No industry ontology — hits are generic ids/labels/scores.

### Task 1

- [ ] One clear hit → no request.
- [ ] Two near-score hits → candidate_select; gate pick → chosen hit.
- [ ] Conflicting attr values → conflict_resolve.
- [ ] Commit: `feat(retrieval): object disambiguation adapter on R2 protocol`

## Status

Pending.
