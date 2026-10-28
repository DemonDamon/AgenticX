# AGX Data Suite P3-Spine-5 — A8 Patrol + E2E + README

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-spine-index.plan.md`

**Goal:** Close the spine: schedule-tick quality + dict-drift webhooks on golden-path rows; one orchestrator script; single pytest e2e; README one-command; update roadmap status.

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/golden_path/seed/quality_patrol.yaml` | Patrol thresholds for seed |
| `examples/data_suite/golden_path/patrol_stage.py` | QualityPatrolRunner + DictDriftRunner + FakeWebhookSink |
| `examples/data_suite/golden_path/run_golden_path.py` | Orchestrates probe→job→gov→tags→board→patrol; exit 0 |
| `examples/data_suite/golden_path/README.md` | One command + stage map + watermark env note |
| `tests/data_suite/test_golden_path_e2e.py` | Full spine assertion (webhooks emitted, stages ok) |
| Update after-a8 roadmap / spine index status | Mark Track 1 / S1 done when green |

## Interfaces

```python
def run_patrol_stage(rows, *, quality_patrol_yaml, dictionary_yaml) -> dict:
    """Return {"webhook_kinds": list[str], "todos": int}."""

# run_golden_path.py prints JSON or plain lines:
# PROBE ok | JOB rows=N | GOV ... | TAGS audience=N | BOARD widgets=N | PATROL webhooks=...
```

### Task 1

- [ ] E2E pytest: one function runs full spine; asserts webhook kinds include quality and/or dict_drift; masked sample present.
- [ ] `run_golden_path.py` + README with `python examples/data_suite/golden_path/run_golden_path.py`.
- [ ] Commit: `feat(data-suite): golden-path e2e + README one-command`
- [ ] Update `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-spine-index.plan.md` and after-a8 roadmap Track 1 status.
