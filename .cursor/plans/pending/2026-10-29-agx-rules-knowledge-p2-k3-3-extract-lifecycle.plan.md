# AGX Rules & Knowledge P2 — K3-3 Extract → lifecycle drafts

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p2-k3-index.plan.md`
> **Depends on:** K3-1, K3-2, K2 lifecycle on main

**Goal:** Pluggable extractor turns source documents into KnowledgeObject drafts (kind=entity / relation) upserted into K2 `KnowledgeObjectFileStore`, updating the source→object index. No LLM in tests.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/incremental/extract.py` | Extractor protocol, ExtractedGraph, apply_extraction |
| `tests/knowledge/graphers/incremental/test_extract.py` | Mock extractor → drafts + index links |

## Interfaces

```python
@dataclass
class ExtractedEntity:
    id: str
    name: str
    entity_type: str = "unknown"
    attrs: dict = field(default_factory=dict)
    source_id: str = ""

@dataclass
class ExtractedRelation:
    id: str
    source_entity_id: str
    target_entity_id: str
    relation_type: str = "related_to"
    attrs: dict = field(default_factory=dict)
    source_id: str = ""

@dataclass
class ExtractedGraph:
    entities: list[ExtractedEntity]
    relations: list[ExtractedRelation]

class Extractor(Protocol):
    def extract(self, doc: SourceDocument) -> ExtractedGraph: ...

def apply_extraction(
    docs: list[SourceDocument],
    *,
    extractor: Extractor,
    object_store: KnowledgeObjectFileStore,
    index: SourceObjectIndex,
    actor: str = "extractor",
) -> list[KnowledgeObject]:
    """Extract each doc; upsert entity/relation KnowledgeObjects as draft; replace_links per source."""
```

Entity KnowledgeObject: `kind="entity"`, attrs include name/entity_type; `source_ids=[doc.id]`.
Relation KnowledgeObject: `kind="relation"`, attrs include relation_type; relations list points to entity object ids; `source_ids=[doc.id]`.

### Task 1

- [x] Mock extractor returns fixed entities/relations; apply_extraction upserts drafts; index.objects_for(source) matches; re-extract replaces links.
- [x] Commit: `feat(knowledge): graph incremental extract to lifecycle drafts`

## Status

Done on `feat/agx-rules-knowledge-p2-k3` (K3-3).
