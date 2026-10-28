# AGX Data Suite P3-Spine-3 — Governance + Tags + Audience

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-spine-index.plan.md`

**Goal:** On the same seed/dst rows, run dictionary lookup, quality rollup, tag compute, and audience select so the demo story has governance + 圈选.

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/golden-path/seed/dictionary.yaml` | Field defs for member seed (desensitized) |
| `examples/data_suite/golden-path/seed/quality.yaml` | QualityRollup thresholds |
| `examples/data_suite/golden-path/seed/tags.yaml` | Tag catalog |
| `examples/data_suite/golden-path/seed/audience.yaml` | Audience DSL expression |
| `examples/data_suite/golden-path/governance_stage.py` | dict + quality helpers |
| `examples/data_suite/golden-path/tags_stage.py` | tag compute + `select_audience` |
| `tests/data_suite/test_golden_path_gov_tags.py` | Quality snapshot + non-empty audience |

## Interfaces

```python
def run_governance_stage(rows, *, dictionary_yaml, quality_yaml) -> dict:
    """Return {"catalog_fields": int, "quality": QualitySnapshot-like dict}."""

def run_tags_stage(rows, *, tags_yaml, audience_yaml) -> dict:
    """Return {"tagged": int, "audience_size": int, "audience_ids": list}."""
```

### Task 1

- [ ] Failing tests for quality metrics and audience size > 0 on seed.
- [ ] Implement seed YAMLs + stage helpers.
- [ ] Commit: `feat(data-suite): golden-path governance + tags/audience stage`
