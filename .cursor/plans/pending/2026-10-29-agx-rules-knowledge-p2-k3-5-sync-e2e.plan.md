# AGX Rules & Knowledge P2 — K3-5 Sync orchestrator + e2e

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p2-k3-index.plan.md`
> **Depends on:** K3-1…K3-4

**Goal:** `IncrementalGraphSync.sync(docs)` runs: fingerprint commit → resolve affected → extract only needs_extract → optional auto review/publish → merge into graph → SyncReport (auditable). Ship README + closed-loop e2e proving unchanged sources are not re-extracted.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/incremental/sync.py` | IncrementalGraphSync, SyncReport, SyncRunStore |
| `agenticx/knowledge/graphers/incremental/README.md` | Library sample (synthetic only) |
| `agenticx/knowledge/graphers/incremental/__init__.py` | Final exports |
| `tests/knowledge/graphers/incremental/test_sync_e2e.py` | Two-pass sync; skip unchanged; trail + report |

## Interfaces

```python
@dataclass
class SyncReport:
    run_id: str
    added: list[str]
    changed: list[str]
    removed: list[str]
    unchanged: list[str]
    extracted_source_ids: list[str]
    touched_object_ids: list[str]
    published_object_ids: list[str]
    graph_stats: dict
    at: str

class IncrementalGraphSync:
    def __init__(
        self,
        root,
        *,
        extractor: Extractor,
        object_store: KnowledgeObjectFileStore | None = None,
        trail: ChangeTrailStore | None = None,
        graph: KnowledgeGraph | None = None,
        actor: str = "sync",
        auto_publish: bool = False,
    ): ...
    def sync(self, docs: list[SourceDocument]) -> SyncReport: ...
```

Persist `sync_runs.json` append-only under incremental root.

### Task 1

- [x] E2E: first sync extracts all; second sync with one content change extracts only that source; unchanged not in extracted_source_ids; if auto_publish, graph contains published entities; SyncReport persisted.
- [x] README sample; mark index Status complete.
- [x] Commit: `feat(knowledge): graph incremental sync orchestrator and e2e`

## Status

Done on `feat/agx-rules-knowledge-p2-k3` (K3-5).
