# AGX Data Suite P2-A8-2 — Quality Patrol Agent

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a8-index.plan.md`

**Goal:** Scheduled quality patrol: run `QualityRollup` on provided rows, compare to thresholds, emit `quality_alert` webhook when breached.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/managed/templates/data_suite/quality_patrol.py` | `QualityPatrolConfig`, `QualityPatrolRunner` |
| `tests/data_suite/fixtures/sample_quality_patrol.yaml` | Metrics + thresholds |
| `tests/managed/templates/test_quality_patrol.py` | Threshold breach → webhook |

## Interfaces

```python
@dataclass(frozen=True)
class QualityPatrolConfig:
    metrics_yaml: Path
    thresholds: dict[str, float]  # metric_id -> max allowed (e.g. null_rate)
    day: str

class QualityPatrolRunner:
    def __init__(self, config: QualityPatrolConfig, notifier: WebhookNotifier): ...
    def run(self, rows: list[dict], *, quarantine: list[dict] | None = None) -> QualitySnapshot:
        """Compute rollup; emit quality_alert for each breached threshold; return snapshot."""
```

Reuse `agenticx.data_suite.governance.quality.QualityRollup` — do not fork metrics engine.

### Task 1

- [ ] Failing test: high null_rate emits webhook with metric id + value.
- [ ] Implement runner.
- [ ] Commit: `feat(managed): quality patrol template over QualityRollup`
