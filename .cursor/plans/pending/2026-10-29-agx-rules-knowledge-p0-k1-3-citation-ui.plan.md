# AGX Rules & Knowledge P0 — K1-3 Citation UI contract

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p0-index.plan.md`

**Goal:** Define a JSON view-model for citation / conflict display shared by web-portal and admin-console; ship a pure serializer + snapshot test (UI pixel work optional follow-up).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/retrieval/citation_view.py` | `to_citation_view(bundle) -> dict` |
| `tests/retrieval/test_citation_view.py` | Snapshot of view-model keys |
| `docs/agx-rules-knowledge-suite/citation-ui-contract.md` | Field contract for frontend |

## Interfaces

```python
def to_citation_view(bundle: EvidenceBundle) -> dict:
    # {entity_id, citations:[{label, source_type, source_id, excerpt, confidence}], conflicts:[...], missing:[...]}
```

### Task 1

- [ ] Serializer + docs; index marked complete when R1+K1 gates green.
- [ ] Commit: `feat(retrieval): citation view-model contract`

## Status

Pending
