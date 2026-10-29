# AGX Rules & Knowledge P1 — K2-1 Knowledge object model + store

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-k2-index.plan.md`

**Goal:** Introduce the first-class KnowledgeObject entity (CRUD, version, status machine draft→pending_review→published→retired) with JSON file-store persistence patterned after `agenticx/rules/store.py` / R1-1.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/lifecycle/__init__.py` | Export KnowledgeObject, KnowledgeStatus, store, transition helpers |
| `agenticx/knowledge/lifecycle/model.py` | Dataclasses + status enum + allowed transitions |
| `agenticx/knowledge/lifecycle/store.py` | `KnowledgeObjectFileStore` → `objects.json` under resolve_store_dir |
| `tests/knowledge/lifecycle/__init__.py` | Package marker |
| `tests/knowledge/lifecycle/test_object_model.py` | Status transitions, validation |
| `tests/knowledge/lifecycle/test_object_store.py` | Upsert / list / get / version bump / persist reload |

## Interfaces

```python
class KnowledgeStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    PUBLISHED = "published"
    RETIRED = "retired"

ALLOWED_TRANSITIONS = {
    KnowledgeStatus.DRAFT: {KnowledgeStatus.PENDING_REVIEW, KnowledgeStatus.RETIRED},
    KnowledgeStatus.PENDING_REVIEW: {
        KnowledgeStatus.PUBLISHED,
        KnowledgeStatus.DRAFT,       # reject → revise
        KnowledgeStatus.RETIRED,
    },
    KnowledgeStatus.PUBLISHED: {KnowledgeStatus.RETIRED, KnowledgeStatus.DRAFT},  # revise new draft version via store bump
    KnowledgeStatus.RETIRED: {KnowledgeStatus.DRAFT},  # reopen as new draft (version bump at store)
}

@dataclass
class KnowledgeObject:
    id: str
    kind: str                          # generic type label (e.g. "entity", "document_clause")
    status: KnowledgeStatus = KnowledgeStatus.DRAFT
    version: int = 1
    attrs: dict = field(default_factory=dict)
    relations: list[dict] = field(default_factory=list)  # [{rel, target_id, ...}]
    source_ids: list[str] = field(default_factory=list)  # external / multi-source ids
    meta: dict = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""

class KnowledgeObjectFileStore:
    def list_objects(self, *, status: KnowledgeStatus | None = None) -> list[KnowledgeObject]: ...
    def get_object(self, object_id: str) -> KnowledgeObject: ...
    def upsert_object(self, obj: KnowledgeObject, *, bump_version: bool = False) -> KnowledgeObject: ...
    def transition(self, object_id: str, to: KnowledgeStatus) -> KnowledgeObject: ...
```

Env: `AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR` else `.runtime/knowledge-lifecycle`.

### Task 1

- [ ] Failing tests: invalid transition raises; missing object KeyError; empty store lists [].
- [ ] Implement model + store; green tests (tmp_path persist/reload).
- [ ] Commit: `feat(knowledge): knowledge object lifecycle model and file store`

## Status

Pending (K2-1).
