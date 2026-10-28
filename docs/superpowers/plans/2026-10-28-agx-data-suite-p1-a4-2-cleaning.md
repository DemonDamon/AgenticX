# AGX Data Suite P1-A4-2 — Cleaning Rules Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development task-by-task.
> **Parent index:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-index.plan.md`
> Execute only after A4-1 Done criteria pass.

**Goal:** Config-driven cleaning rule templates: apply to row batches, quarantine failures, leave full audit trail — no hardcoded project rules in trunk.

**Architecture:** `CleaningEngine` loads a YAML ruleset (rule id → template + params). Built-in templates: `not_null`, `regex`, `in_set`, `trim`. Failures go to quarantine list with rule_id + reason; successes return cleaned rows. This slice is library-only (DataFlow clean-node wiring optional later).

**Tech Stack:** Python 3.10+, pytest, PyYAML.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/governance/cleaning.py` | Ruleset load + `CleaningEngine.apply` |
| `tests/data_suite/fixtures/sample_cleaning_rules.yaml` | Synthetic ruleset |
| `tests/data_suite/test_governance_cleaning.py` | Apply / quarantine / audit |

## Interfaces

```python
@dataclass
class CleanResult:
    rows: list[dict]
    quarantine: list[dict]  # each: {"row": ..., "rule_id": ..., "reason": ...}
    audit: list[dict]       # each: {"rule_id": ..., "passed": int, "failed": int}

class CleaningEngine:
    def load_ruleset(self, path: str | Path) -> None: ...
    def apply(self, rows: list[dict], *, ruleset_id: str | None = None) -> CleanResult: ...
```

### Task 1: not_null + regex templates with quarantine

- [ ] Write tests that null `member_id` is quarantined; bad mobile_hash regex quarantined; good rows pass.
- [ ] Implement `CleaningEngine` + fixture YAML.
- [ ] `pytest tests/data_suite/test_governance_cleaning.py -v` PASS
- [ ] Commit: `feat(data-suite): cleaning rules engine with quarantine audit`

### Task 2: in_set + trim templates + audit counts

- [ ] Tests for `in_set` reject and `trim` mutation on surviving rows.
- [ ] Audit aggregates passed/failed per rule_id.
- [ ] Commit: `feat(data-suite): cleaning in_set/trim templates and audit rollup`

## Done criteria

- [ ] Four templates green on fixtures
- [ ] Quarantine never silently drops without audit entry
