# AGX Data Suite P4-B-Pack-2 — B1 channels + B4 idmapping

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-data-suite-p4-b-pack-index.plan.md`

**Goal:** Skeleton pack ships synthetic channel + idmapping configs; `register_pack` applies them onto ChannelRegistry + IdMapping profile store (in-memory / file).

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/delivery_pack/pack.yaml` | Manifest for skeleton pack |
| `examples/data_suite/delivery_pack/channels/channels.yaml` | FakeChannel src/dst (no secrets) |
| `examples/data_suite/delivery_pack/idmapping/profile.yaml` | Synthetic OneID profile |
| `agenticx/data_suite/pack/register.py` | `register_pack(pack, *, registry, ...) -> RegisterReport` |
| `tests/data_suite/test_pack_register_channels.py` | Registers FakeChannel; probe ok |

### Task 1

- [ ] Skeleton YAML committed (Brand-A / Market-X wording only).
- [ ] `register_pack` wires channels + idmapping; unit test green.
- [ ] Commit: `feat(data-suite): register delivery pack channels and idmapping`
