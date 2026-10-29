# AGX Data Suite P4-B-Pack-5 — Apply CLI + e2e gate

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-data-suite-p4-b-pack-index.plan.md`

**Goal:** One command applies the skeleton pack and a pytest gate covers the full register path.

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/delivery_pack/apply.py` | CLI: load + register + print RegisterReport |
| `tests/data_suite/test_delivery_pack_e2e.py` | End-to-end on skeleton pack |
| Index status flip to Impl complete |

### Task 1

- [x] `python examples/data_suite/delivery_pack/apply.py` exits 0.
- [x] `pytest tests/data_suite/test_delivery_pack*.py tests/data_suite/test_pack_*.py -q` green.
- [x] Commit: `test(data-suite): delivery pack e2e apply gate`

## Status

Done on `feat/agx-data-suite-p4-b-pack`.
