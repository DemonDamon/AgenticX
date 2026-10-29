# AGX Rules & Knowledge P0 — K1-1 Provenance on RetrievalResult

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p0-index.plan.md`

**Goal:** Add a standard provenance structure to retrieval results (source type, id, data time, confidence, context pointer) without breaking existing retrievers.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/retrieval/provenance.py` | Provenance / SourceType dataclasses + helpers |
| `agenticx/retrieval/base.py` | Optional `provenance` on RetrievalResult |
| `tests/retrieval/test_provenance.py` | Construction + serialization round-trip |

## Interfaces

```python
class SourceType(str, Enum):
    STRUCTURED = "structured"
    GRAPH = "graph"
    DOCUMENT = "document"
    INFERENCE = "inference"

@dataclass
class Provenance:
    source_type: SourceType
    source_id: str
    data_time: str | None = None
    confidence: float | None = None
    context_ptr: str | None = None  # chunk / row / edge pointer
```

### Task 1

- [x] Extend RetrievalResult with optional provenance; helpers to attach.
- [x] Commit: `feat(retrieval): standard provenance fields`

## Status

Done on `feat/agx-rules-knowledge-p0`.
