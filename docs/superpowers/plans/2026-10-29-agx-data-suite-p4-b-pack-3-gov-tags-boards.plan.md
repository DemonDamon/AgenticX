# AGX Data Suite P4-B-Pack-3 — B2 governance/tags + B3 boards

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-data-suite-p4-b-pack-index.plan.md`

**Goal:** Skeleton packs dictionary, quality, tags, audience, and one board; register into FileStore / TagCatalog / BoardSpec.

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/delivery_pack/dictionary/fields.yaml` | ~8–12 synthetic fields |
| `examples/data_suite/delivery_pack/quality/rules.yaml` | Sample quality rules |
| `examples/data_suite/delivery_pack/tags/catalog.yaml` | Tiered tags with 四要素 stubs |
| `examples/data_suite/delivery_pack/tags/audience.yaml` | One audience sample |
| `examples/data_suite/delivery_pack/boards/member_overview.yaml` | Config board (A6 shape) |
| `agenticx/data_suite/pack/register.py` | Extend for B2/B3 |
| `tests/data_suite/test_pack_register_gov_boards.py` | Dictionary + board load |

### Task 1

- [ ] YAML + register extensions + tests green.
- [ ] Commit: `feat(data-suite): register delivery pack governance tags and boards`
