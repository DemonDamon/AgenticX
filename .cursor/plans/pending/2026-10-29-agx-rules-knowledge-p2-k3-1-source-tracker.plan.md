# AGX Rules & Knowledge P2 — K3-1 Source change tracker

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p2-k3-index.plan.md`

**Goal:** Detect added / changed / removed / unchanged source documents via content hashes so later slices only reprocess affected sources (avoid full rebuild).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/incremental/__init__.py` | Package exports (grow per slice) |
| `agenticx/knowledge/graphers/incremental/sources.py` | SourceDocument, content_hash, ChangeSet, SourceChangeTracker |
| `tests/knowledge/graphers/__init__.py` | Package marker |
| `tests/knowledge/graphers/incremental/__init__.py` | Package marker |
| `tests/knowledge/graphers/incremental/test_sources.py` | Hash stability, diff categories, persist/reload |

## Interfaces

```python
def content_hash(text: str) -> str:  # sha256 hex of UTF-8 normalized text (strip trailing whitespace per line? keep simple: text.encode utf-8)

@dataclass
class SourceDocument:
    id: str
    content: str
    content_hash: str = ""   # auto-filled from content if empty
    meta: dict = field(default_factory=dict)

@dataclass
class ChangeSet:
    added: list[str]
    changed: list[str]
    removed: list[str]
    unchanged: list[str]

    @property
    def needs_extract(self) -> list[str]:  # added + changed

class SourceChangeTracker:
    def __init__(self, root: Path | str | None = None): ...
    def snapshot(self) -> dict[str, str]:  # id -> hash
    def commit(self, docs: list[SourceDocument]) -> ChangeSet:  # diff vs prior, then persist new fingerprints
    def diff(self, docs: list[SourceDocument]) -> ChangeSet:  # dry-run, no persist
```

Env: `AGX_GRAPH_INCREMENTAL_STORE_DIR` else `.runtime/graph-incremental`. Persist `fingerprints.json`.

### Task 1

- [x] Failing tests: empty tracker treats all as added; hash change → changed; missing id → removed; identical → unchanged; persist reload.
- [x] Implement sources.py + green tests.
- [x] Commit: `feat(knowledge): graph incremental source change tracker`

## Status

Done on `feat/agx-rules-knowledge-p2-k3` (K3-1).
