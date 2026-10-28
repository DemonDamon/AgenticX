# AGX Data Suite P0-A3 — ID-Mapping engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Parent index:** `.cursor/plans/pending/2026-10-27-agx-data-suite-p0-index.plan.md`
> **Depends-On:** P0-A2 runner (transform node calls this engine)

**Goal:** Configurable ID association + merge with conflict policy and snapshot replay — generic OneID building block with **zero** hard-coded phone/member/VIN semantics in trunk.

**Architecture:** `agenticx/data_suite/idmapping/` loads a YAML mapping profile (ID types, edge rules, priority). Engine outputs canonical `subject_id` plus link rows. Snapshots are immutable JSON files for replay.

**Tech Stack:** Python 3.10+, PyYAML, pytest.

## Global Constraints

(Inherited.) Example fixtures may use `phone` / `crm_id` as **config values**, never as engine keywords.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/idmapping/__init__.py` | Exports |
| `agenticx/data_suite/idmapping/profile.py` | Profile load |
| `agenticx/data_suite/idmapping/engine.py` | Merge + replay |
| `agenticx/data_suite/idmapping/store.py` | Snapshot IO |
| `tests/data_suite/fixtures/idmap_profile.yaml` | Sample profile |
| `tests/data_suite/test_idmapping_engine.py` | Merge/conflict/replay |
| `tests/data_suite/test_jobs_runner.py` | Update to use real engine |

---

### Task 1: Profile loader

- [ ] Create `idmap_profile.yaml` with configurable id_types + merge.priority + on_conflict.
- [ ] Test loads types and priority list.
- [ ] Commit: `feat(data-suite): ID-Mapping profile loader`

---

### Task 2: Merge engine

**Interfaces:**
- Produces: `IdMappingEngine(profile).merge(records) -> MergeResult(records, links, snapshot_id, conflicts)`

- [ ] Shared phone → same subject_id.
- [ ] Conflict with `prefer_priority` keeps higher-priority id and logs conflict.
- [ ] `on_conflict: reject` skips conflicting row.
- [ ] Commit: `feat(data-suite): ID-Mapping merge with conflict policy`

---

### Task 3: Snapshot + replay

- [ ] `merge` persists snapshot; `replay(snapshot_id)` returns identical records.
- [ ] Commit: `feat(data-suite): ID-Mapping snapshot replay`

---

### Task 4: Wire into DataFlow transform node

- [ ] Replace `PassthroughIdMap` in runner tests with `IdMappingEngine.from_yaml(...)`.
- [ ] Commit: `feat(data-suite): wire ID-Mapping into DataFlow transform node`

---

### Task 5: P0 gate

- [ ] `pytest tests/data_suite/ -v` non-integration PASS
- [ ] Update parent + index status notes
- [ ] Commit: `docs(plans): P0 Data Suite A1-A3 vertical slice complete`

**A3 / P0 Done criteria:** Configurable two-ID merge + conflicts + replay; sample YAML job uses real engine end-to-end on FakeChannel.
