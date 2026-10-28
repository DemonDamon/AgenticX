# AGX Data Suite P2-A8-3 — Dictionary / 口径 Drift Patrol

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a8-index.plan.md`

**Goal:** Compare dictionary field expectations vs observed sample stats; produce `GovernanceTodo` items and webhook `dict_drift`.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/managed/templates/data_suite/dict_drift.py` | `DictDriftConfig`, `DictDriftRunner`, `GovernanceTodo` usage |
| `tests/data_suite/fixtures/sample_dict_drift.yaml` | Dictionary + expected presence/null ceilings |
| `tests/managed/templates/test_dict_drift.py` | Missing field / null ceiling → todos |

## Interfaces

```python
@dataclass(frozen=True)
class GovernanceTodo:
    field: str
    reason: str  # missing_in_sample | null_rate_exceeded | unknown_field
    detail: dict

@dataclass(frozen=True)
class DictDriftConfig:
    dictionary_yaml: Path
    null_rate_ceiling: float = 0.2
    require_fields: tuple[str, ...] = ()

class DictDriftRunner:
    def __init__(self, config: DictDriftConfig, notifier: WebhookNotifier): ...
    def run(self, rows: list[dict]) -> list[GovernanceTodo]:
        """Load DictionaryCatalog; emit todos + webhook when drift detected."""
```

Reuse `DictionaryCatalog` — drift is A-layer heuristics only (presence / null rate); customer-specific 口径 SQL stays B-layer config later.

### Task 1

- [ ] Failing tests: required field absent → todo; null_rate over ceiling → todo + webhook.
- [ ] Implement runner.
- [ ] Commit: `feat(managed): dictionary drift patrol template`
