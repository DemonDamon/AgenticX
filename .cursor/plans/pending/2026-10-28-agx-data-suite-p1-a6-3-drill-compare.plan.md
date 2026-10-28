# AGX Data Suite P1-A6-3 — Drill & Compare

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a6-index.plan.md`
> After A6-2.

**Goal:** Drill path (L1→L2→…) and compare mode (two filter contexts) over the same binder.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/dashboard/explore.py` | `DrillPath`, `compare_series` |
| `tests/data_suite/test_dashboard_explore.py` | drill + compare |

## Interfaces

```python
@dataclass
class DrillPath:
    levels: list[str]  # field names L1..Ln
    values: list[str]  # selected prefixes; len <= len(levels)

def apply_drill(rows: list[dict], path: DrillPath) -> list[dict]: ...
def next_group_field(path: DrillPath) -> str | None: ...

def compare_series(
    widget: WidgetSpec,
    rows: list[dict],
    *,
    left_filters: dict,
    right_filters: dict,
    left_label: str = "A",
    right_label: str = "B",
) -> list[ChartSeries]: ...
```

### Task 1

- [x] Tests: drill filters cascade; compare returns two series; leaf drill has no next field.
- [x] Commit: `feat(data-suite): dashboard drill path and compare series`
