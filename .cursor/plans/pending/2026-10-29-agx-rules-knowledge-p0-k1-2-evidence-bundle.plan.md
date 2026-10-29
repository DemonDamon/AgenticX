# AGX Rules & Knowledge P0 — K1-2 Evidence bundle

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p0-index.plan.md`

**Goal:** Object-centric EvidenceBundle that aggregates ledger attrs, related records, graph edges, and document clauses with missing/conflict hints.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/retrieval/evidence.py` | EvidenceItem, EvidenceBundle, assemble_evidence |
| `tests/retrieval/test_evidence_bundle.py` | Multi-source assemble; conflict + missing flags |

## Interfaces

```python
@dataclass
class EvidenceItem:
    kind: str
    payload: dict
    provenance: Provenance

@dataclass
class EvidenceBundle:
    entity_id: str
    items: list[EvidenceItem]
    summary: str
    missing: list[str]
    conflicts: list[dict]

def assemble_evidence(entity_id: str, sources: list[EvidenceItem], *, policy: dict | None = None) -> EvidenceBundle: ...
```

### Task 1

- [x] Assemble sorts by confidence/time; emits missing/conflicts.
- [x] Commit: `feat(retrieval): object-centric evidence bundle`

## Status

Done on `feat/agx-rules-knowledge-p0`.
