# AGX Data Suite P1-A6-2 — Dataset Binder

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a6-index.plan.md`
> After A6-1.

**Goal:** Bind in-memory row tables to widget encodings → `ChartSeries` for UI cards.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/dashboard/binder.py` | `DatasetStore`, `bind_widget` |
| `tests/data_suite/fixtures/sample_board_rows.json` | Synthetic rows |
| `tests/data_suite/test_dashboard_binder.py` | filter/group/metric |

## Interfaces

```python
@dataclass
class ChartPoint:
    name: str
    value: float

@dataclass
class ChartSeries:
    widget_id: str
    title: str
    chart: str
    points: list[ChartPoint]
    meta: dict

class DatasetStore:
    def load_json(self, path: str | Path) -> None: ...  # {dataset_id: [rows]}
    def rows(self, dataset_id: str) -> list[dict]: ...

def bind_widget(widget: WidgetSpec, rows: list[dict], *, filters: dict | None = None) -> ChartSeries: ...
```

Supported: filters as `{field: value}` equality; metrics count/sum/avg; group_by → points.

### Task 1

- [x] Tests for count/sum/avg + filter + empty.
- [x] Commit: `feat(data-suite): dashboard dataset binder for chart series`
