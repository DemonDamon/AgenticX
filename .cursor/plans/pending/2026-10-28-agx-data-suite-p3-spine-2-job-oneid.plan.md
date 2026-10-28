# AGX Data Suite P3-Spine-2 — DataFlow Job + OneID

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-spine-index.plan.md`

**Goal:** Run one JobSpec (extract→clean→transform idmap→load) over golden-path FakeChannels and produce OneID-merged dst rows.

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/golden_path/seed/job.yaml` | JobSpec referencing src/dst + idmap profile |
| `examples/data_suite/golden_path/seed/idmap_profile.yaml` | Id types / merge keys for synthetic members |
| `examples/data_suite/golden_path/pipeline.py` | `run_job_stage(registry, job_path, idmap) -> JobRunResult` |
| Extend `tests/data_suite/test_golden_path_probe.py` or add `test_golden_path_job.py` | Job lands rows on dst; OneID field present |

## Interfaces

```python
def run_job_stage(
    *,
    registry: ChannelRegistry,
    job_path: Path,
    idmap_engine: IdMappingEngine,
) -> JobRunResult: ...
```

Reuse `agenticx.data_suite.jobs.runner` / `load_job` / `IdMappingEngine` — do not fork DSL.

### Task 1

- [ ] Failing test: after job, dst table `members_out` has rows and a stable `one_id` (or profile-defined) key.
- [ ] Implement job.yaml + idmap_profile + pipeline.run_job_stage.
- [ ] Commit: `feat(data-suite): golden-path DataFlow + OneID stage`
