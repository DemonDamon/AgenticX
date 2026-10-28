# AGX Data Suite P1-A4-4 — Quality Metrics + Daily Rollup

> **Parent index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-index.plan.md`
> Execute only after A4-3 Done criteria pass.

**Goal:** Config metrics (null_rate, distinct_count, rule_fail_rate) with a day-keyed snapshot store and a hook callable from DataFlow schedule.

**Architecture:** `QualityRollup.compute_day` reads rows (or quarantine stats) + metric YAML → `QualitySnapshot` persisted via simple JSON/YAML file store (swap to CH later via channel write + grant).

**Tech Stack:** Python 3.10+, pytest, PyYAML.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/governance/quality.py` | Metrics + rollup + store |
| `tests/data_suite/fixtures/sample_quality_metrics.yaml` | Metric defs |
| `tests/data_suite/test_governance_quality.py` | Day rollup + persistence |

## Interfaces

```python
@dataclass
class QualitySnapshot:
    day: str
    metrics: dict[str, float]
    meta: dict

class QualityRollup:
    def load_metrics(self, path: str | Path) -> None: ...
    def compute_day(self, day: str, rows: list[dict], *, quarantine: list[dict] | None = None) -> QualitySnapshot: ...
    def save(self, snap: QualitySnapshot, path: str | Path) -> None: ...
    def load_day(self, path: str | Path) -> QualitySnapshot: ...
```

### Task 1: null_rate + rule_fail_rate + save/load

- [ ] Tests on synthetic rows/quarantine.
- [ ] Commit: `feat(data-suite): quality metrics daily rollup store`

## Done criteria

- [ ] Metrics change by editing YAML only
- [ ] Snapshot round-trip green
