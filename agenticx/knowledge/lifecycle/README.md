# Knowledge object lifecycle (K2)

Reusable A-layer spine for knowledge-object **lifecycle + quality governance**.

## Status machine

`draft` → `pending_review` → `published` → `retired`  
(reject: `pending_review` → `draft`; revise: `published`/`retired` → `draft`)

## Closed loop (library)

1. **Ingest** drafts via `KnowledgeObjectFileStore.upsert_object` (optionally `ingest_with_idmapping`).
2. **Quality** via `run_quality_checks(objects, policy=...)`.
3. **Issues** via `IssueFileStore.open_from_findings` → resolve / waive.
4. **Review / publish** via `store.transition(..., PENDING_REVIEW)` then `PUBLISHED` (or `RETIRED`).
5. **Trail** via optional `ChangeTrailStore` injected into the object store.

Synthetic example (no domain ontology):

```python
from agenticx.knowledge.lifecycle import (
    KnowledgeObject,
    KnowledgeObjectFileStore,
    KnowledgeStatus,
    ChangeTrailStore,
    run_quality_checks,
    IssueFileStore,
    IssueStatus,
)

trail = ChangeTrailStore("/tmp/k2-demo")
store = KnowledgeObjectFileStore("/tmp/k2-demo", trail=trail, actor="ops")
issues = IssueFileStore("/tmp/k2-demo")

store.upsert_object(KnowledgeObject(id="ent-1", kind="entity", attrs={"name": "Sample"}))
findings = run_quality_checks(store.list_objects(), policy={"required_attrs": {"entity": ["name"]}})
opened = issues.open_from_findings(findings)
for iss in opened:
    issues.transition(iss.id, IssueStatus.RESOLVED, actor="ops")
store.transition("ent-1", KnowledgeStatus.PENDING_REVIEW)
store.transition("ent-1", KnowledgeStatus.PUBLISHED)
```

Admin-console **数据治理 / knowledge-lifecycle** UI shipped (PR #147, `cdb601d1`) at `/admin/knowledge-lifecycle` — object list/detail, transitions, quality issues, change trail. This package remains the A-layer spine the admin store mirrors.
