# AGX Data Suite P1-A4-3 — Trust Grade Arbitration

> **Parent index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-index.plan.md`
> Execute only after A4-2 Done criteria pass.

**Goal:** Configurable trust grades (default S/A/B/C) with arbitration priority when multiple sources disagree — grades and priorities are YAML, not code.

**Architecture:** `TrustArbiter` loads a profile: grade labels + source priority + field-level conflict policy (`prefer_higher_grade` | `prefer_source_order`). Outputs `TrustDecision` with chosen value, grade, and reason.

**Tech Stack:** Python 3.10+, pytest, PyYAML.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/governance/trust.py` | Profile + arbiter |
| `tests/data_suite/fixtures/sample_trust_profile.yaml` | S/A/B/C + source order |
| `tests/data_suite/test_governance_trust.py` | Conflict samples |

## Interfaces

```python
@dataclass
class TrustDecision:
    field: str
    value: object
    grade: str
    source: str
    reason: str

class TrustArbiter:
    def load_profile(self, path: str | Path) -> None: ...
    def grade(self, candidates: list[dict], *, field: str) -> TrustDecision: ...
    # candidate: {"value": ..., "source": ..., "grade": "A"}
```

### Task 1: Default S/A/B/C priority + prefer_higher_grade

- [ ] Tests: A vs B picks A; equal grade uses source order from profile.
- [ ] Implement + fixture.
- [ ] Commit: `feat(data-suite): trust grade arbiter with configurable S/A/B/C`

## Done criteria

- [ ] Conflict samples resolve purely by profile YAML changes (engine untouched)
