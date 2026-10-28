# AGX Data Suite P1-A5-3 — Audience Circle-Select DSL

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a5-index.plan.md`
> After A5-2.

**Goal:** YAML/dict audience DSL combining tag predicates with AND/OR/NOT; return matching entity ids from an in-memory table of tag columns.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/audience/__init__.py` | Exports |
| `agenticx/data_suite/audience/dsl.py` | `AudienceQuery`, `select_audience` |
| `tests/data_suite/fixtures/sample_audience.yaml` | Sample query |
| `tests/data_suite/test_audience_dsl.py` | AND/OR/NOT |

## Interfaces

```python
def select_audience(rows: list[dict], query: dict, *, id_field: str = "member_id") -> list[str]:
    """query shape: {op: and|or|not, args: [...]} or {tag: name, op: eq|in|exists, value: ...}"""
```

### Task 1

- [x] Tests: and/or/not over pre-tagged rows; empty match.
- [x] Commit: `feat(data-suite): audience DSL for tag-based circle select`
