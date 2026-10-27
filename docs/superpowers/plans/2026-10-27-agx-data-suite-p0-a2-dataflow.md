# AGX Data Suite P0-A2 — DataFlow job DSL + runner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Parent index:** `.cursor/plans/pending/2026-10-27-agx-data-suite-p0-index.plan.md`
> **Depends-On:** P0-A1 Done (ChannelRegistry + FakeChannel available)

**Goal:** Run a YAML-declared data job through extract → clean → transform → load → snapshot with lineage records and a schedule hook, so AGX has a data-job runtime beside the Agent runtime.

**Architecture:** `agenticx/data_suite/jobs/` owns DSL parse + node runners. Do **not** overload `agenticx/flow/execution_plan.py` (that is agent progress planning). Scheduler integration is a thin `DataJobScheduler.tick()` that tests call directly — avoid editing desktop Electron in P0.

**Tech Stack:** Python 3.10+, PyYAML, pytest, A1 channels.

## Global Constraints

(Inherited from P0 index.) Job YAML must be generic (channel names, SQL, column maps) — no brand/OneID field names hard-coded in engine.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/jobs/__init__.py` | Exports |
| `agenticx/data_suite/jobs/dsl.py` | JobSpec models + `load_job` |
| `agenticx/data_suite/jobs/lineage.py` | Lineage event log |
| `agenticx/data_suite/jobs/nodes.py` | Node executors |
| `agenticx/data_suite/jobs/runner.py` | `run_job` |
| `agenticx/data_suite/jobs/scheduler.py` | Cron-like tick helper |
| `tests/data_suite/fixtures/sample_job.yaml` | E2E fixture |
| `tests/data_suite/test_jobs_dsl.py` | Parse tests |
| `tests/data_suite/test_jobs_runner.py` | Runner E2E with FakeChannel |

---

### Task 1: JobSpec DSL

**Files:**
- Create: `agenticx/data_suite/jobs/__init__.py`
- Create: `agenticx/data_suite/jobs/dsl.py`
- Create: `tests/data_suite/test_jobs_dsl.py`
- Create: `tests/data_suite/fixtures/sample_job.yaml`

**Interfaces:**
- Produces: `JobSpec`, `JobNode`, `load_job(path) -> JobSpec`

- [ ] **Step 1: Fixture YAML** at `tests/data_suite/fixtures/sample_job.yaml` with nodes extract/clean/transform/load/snapshot (channel `src`/`dst`, grant_id `g_load`, idmap `default`).

- [ ] **Step 2: Failing test** `test_load_sample_job` asserting name and node type order.

- [ ] **Step 3: Implement** dataclass/pydantic `JobSpec` + YAML load; reject unknown node types.

- [ ] **Step 4: Pass + commit** `feat(data-suite): job DSL loader for DataFlow`

---

### Task 2: Lineage log

**Files:**
- Create: `agenticx/data_suite/jobs/lineage.py`
- Create: `tests/data_suite/test_jobs_lineage.py`

**Interfaces:**
- Produces: `LineageLog.record(node_id, inputs, outputs, meta)`; `LineageLog.events`

- [ ] Test append-only events with timestamps.
- [ ] Commit: `feat(data-suite): job lineage event log`

---

### Task 3: Node executors + runner

**Files:**
- Create: `agenticx/data_suite/jobs/nodes.py`
- Create: `agenticx/data_suite/jobs/runner.py`
- Create: `tests/data_suite/test_jobs_runner.py`

**Interfaces:**
- Consumes: `ChannelRegistry`; `IdMappingEngine` (until A3 lands, transform may use `PassthroughIdMap`)
- Produces: `async def run_job(spec, *, channels, idmaps) -> JobRunResult`

- [ ] **Step 1: Failing E2E** with FakeChannel src/dst, drop null `id`, passthrough idmap, assert one loaded row + non-empty lineage.

- [ ] **Step 2: Implement nodes** extract/clean/transform/load/snapshot as specified in parent index contracts.

- [ ] **Step 3: Pass + commit** `feat(data-suite): DataFlow runner with five node types`

---

### Task 4: Schedule tick helper

**Files:**
- Create: `agenticx/data_suite/jobs/scheduler.py`
- Create: `tests/data_suite/test_jobs_scheduler.py`

**Interfaces:**
- Produces: `DataJobScheduler(jobs).due(now) -> list[JobSpec]` for 5-field cron subset.

- [ ] Test `* * * * *` due; `0 2 * * *` not due at 03:00.
- [ ] Commit: `feat(data-suite): data job schedule due-checker`

---

### Task 5: A2 Done gate

- [ ] `pytest tests/data_suite/test_jobs_*.py -v` PASS
- [ ] Commit: `test(data-suite): DataFlow P0-A2 gate green`

**A2 Done criteria:** YAML job runs end-to-end on FakeChannel with lineage + due scheduler helper.
