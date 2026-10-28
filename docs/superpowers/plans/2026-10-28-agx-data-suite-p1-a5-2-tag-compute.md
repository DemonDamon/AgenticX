# AGX Data Suite P1-A5-2 — Tag Compute Engine

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a5-index.plan.md`
> After A5-1.

**Goal:** Evaluate configured tag expressions over row batches; attach computed tag columns; record lineage-friendly meta.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/tags/compute.py` | `TagComputeEngine` |
| `tests/data_suite/fixtures/sample_tag_compute.yaml` | Expression defs |
| `tests/data_suite/test_tags_compute.py` | Expression eval |

## Interfaces

```python
@dataclass
class TagComputeResult:
    rows: list[dict]
    computed: list[str]
    meta: dict

class TagComputeEngine:
    def load(self, path: str | Path) -> None: ...  # tag_id -> {type, expr/field}
    def compute(self, rows: list[dict], *, tag_ids: list[str] | None = None) -> TagComputeResult: ...
```

Supported types (P1 slice): `copy_field`, `equals_const`, `in_set`, `bool_and` (field presence).

### Task 1

- [x] Tests for each type + selective tag_ids.
- [x] Commit: `feat(data-suite): tag compute engine for expression tags`
