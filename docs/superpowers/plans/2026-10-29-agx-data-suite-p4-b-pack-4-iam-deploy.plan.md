# AGX Data Suite P4-B-Pack-4 — B5 IAM stub + B6 deploy handbook

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-data-suite-p4-b-pack-index.plan.md`

**Goal:** Document how a real B repo plugs an AuthStrategy instance and ships ops runbooks without putting secrets in AgenticX.

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/delivery_pack/iam/strategy.yaml` | Placeholder strategy id + endpoint shape (no tokens) |
| `examples/data_suite/delivery_pack/docs/DEPLOY.md` | Deploy checklist: env, pack path, register, admin verify |
| `examples/data_suite/delivery_pack/README.md` | How to copy skeleton → separate B repo; desensitize rules |
| `tests/data_suite/test_pack_iam_section.py` | Loader accepts iam section; does not call network |

### Task 1

- [ ] Docs + iam stub + loader coverage.
- [ ] Commit: `docs(data-suite): delivery pack IAM stub and deploy handbook`
