# AGX Rules & Knowledge P1 — K2-3 Quality checkers

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-k2-index.plan.md`
> **Depends on:** K2-1

**Goal:** Pure quality checks over KnowledgeObject(s) producing structured findings for: 标识关联 (id_link), 必填属性 (required_attrs), 关系完整性 (relation_integrity), 重复 (duplicate), 冲突 (conflict), 失效 (stale/retired-but-referenced). No LLM; policy dict configures required fields / relation rules.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/lifecycle/quality.py` | QualityFinding + run_quality_checks |
| `tests/knowledge/lifecycle/test_quality_checks.py` | Each check kind + empty/policy cases |

## Interfaces

```python
@dataclass
class QualityFinding:
    code: str            # id_link|required_attrs|relation_integrity|duplicate|conflict|stale
    severity: str        # error|warning
    object_id: str
    message: str
    detail: dict = field(default_factory=dict)

def run_quality_checks(
    objects: list[KnowledgeObject],
    *,
    policy: dict | None = None,
) -> list[QualityFinding]: ...
```

Policy sketch (config only, no industry names):
```yaml
required_attrs: { entity: [name], document_clause: [title, source_ref] }
relation_targets_must_exist: true
duplicate_keys: [kind, attrs.name]
stale_if_status: [retired]   # flag refs TO retired objects
```

### Task 1

- [x] Implement six check codes; unit tests with synthetic multi-object fixtures.
- [x] Commit: `feat(knowledge): knowledge object quality checkers`

## Status

Done on `feat/agx-rules-knowledge-p1-k2`.
