# AGX Data Suite P2-A8-5 — Examples + E2E Gate

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a8-index.plan.md`

**Goal:** Ship instantiate-ready YAML examples and a single pytest gate proving all three templates.

## File map

| Path | Responsibility |
|------|----------------|
| `examples/managed/data_suite/quality-patrol.apply.yaml` | Apply stub for quality patrol |
| `examples/managed/data_suite/dict-drift.apply.yaml` | Apply stub for 口径 patrol |
| `examples/managed/data_suite/nl2sql.apply.yaml` | Apply stub for NL2SQL (read-only tools) |
| `tests/managed/templates/test_data_suite_e2e.py` | validate_manifest + schedule tick quality/drift + nl2sql deny write |
| Update P2 / parent status docs | Mark A8 done when green |

### Task 1

- [ ] Examples validate via `validate_manifest`.
- [ ] E2E test: one schedule tick quality + drift; nl2sql rejects INSERT.
- [ ] Commit: `feat(managed): data suite agent template examples + e2e gate`
- [ ] Update `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-index.plan.md` and parent plan status.
