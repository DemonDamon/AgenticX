# AGX Data Suite P1-A6-1 — Board Spec / Layout

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a6-index.plan.md`

**Goal:** YAML board catalog: id, title, layout grid, widgets (chart type + dataset ref + encoding).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/dashboard/__init__.py` | Exports |
| `agenticx/data_suite/dashboard/spec.py` | `BoardSpec`, `WidgetSpec`, `load_board` |
| `tests/data_suite/fixtures/sample_board.yaml` | Sample board |
| `tests/data_suite/test_dashboard_spec.py` | Load / validate |

## Interfaces

```python
@dataclass(frozen=True)
class WidgetSpec:
    id: str
    title: str
    chart: str  # bar|line|donut|stat
    dataset: str
    x: str | None = None
    y: str | None = None
    group_by: str | None = None
    metric: str = "count"  # count|sum|avg
    metric_field: str | None = None
    row: int = 0
    col: int = 0
    w: int = 6
    h: int = 4

@dataclass(frozen=True)
class BoardSpec:
    id: str
    title: str
    widgets: list[WidgetSpec]

def load_board(path: str | Path) -> BoardSpec: ...
```

### Task 1

- [x] Tests: load sample; reject unknown chart; preserve layout order.
- [x] Commit: `feat(data-suite): dashboard board spec and layout model`
