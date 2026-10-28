# AGX Data Suite P4 B-Pack — S3 Index

> **Parent roadmap:** `docs/superpowers/plans/2026-10-28-agx-data-suite-after-a8-roadmap.md` (Track 3 / S3)
> **Depends on:** S1+S2 on `main` (PR #141).
> Execute sequentially: S3-1 → S3-5. No parallel sub-agents. No A9 compute.

**Goal:** Ship a **desensitized delivery pack skeleton** plus an A-layer loader so project teams keep the 10–20% customer-specific configs outside AgenticX while plugging into A1–A8.

**Boundary:**
- **In AgenticX (A):** `agenticx/data_suite/pack/` — manifest schema, directory loader, `register_pack()`.
- **In AgenticX (example only):** `examples/data_suite/delivery_pack/` — synthetic Brand-A / Market-X configs (no real company / proposal / product-line codenames).
- **Out of AgenticX (B repo later):** real customer IAM, secrets, private endpoints, industry wide tables. This branch does **not** create the GitHub B repo; README documents how to copy the skeleton.

**Pack layout (B1–B6):**
```
examples/data_suite/delivery_pack/
  pack.yaml
  channels/                 # B1
  dictionary/ quality/ tags/  # B2
  boards/                   # B3
  idmapping/                # B4
  iam/                      # B5
  docs/DEPLOY.md            # B6
```

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| S3-1 | `2026-10-29-agx-data-suite-p4-b-pack-1-schema-loader.plan.md` | PackManifest + load_pack + unit tests green |
| S3-2 | `2026-10-29-agx-data-suite-p4-b-pack-2-channels-idmap.plan.md` | Skeleton B1+B4; register_pack wires FakeChannel + IdMapping |
| S3-3 | `2026-10-29-agx-data-suite-p4-b-pack-3-gov-tags-boards.plan.md` | B2+B3 load into store / tags / boards |
| S3-4 | `2026-10-29-agx-data-suite-p4-b-pack-4-iam-deploy.plan.md` | B5 iam stub + B6 DEPLOY.md + copy-to-B-repo README |
| S3-5 | `2026-10-29-agx-data-suite-p4-b-pack-5-e2e-readme.plan.md` | One-command apply + pytest gate |

## E2E gate (whole S3)

1. `pytest tests/data_suite/test_delivery_pack*.py tests/data_suite/test_pack_*.py -q` green.
2. `python examples/data_suite/delivery_pack/apply.py` exits 0 and prints registered resource counts.
3. No real customer / company / proposal identifiers under `examples/data_suite/delivery_pack/`.

## Branch

`feat/agx-data-suite-p4-b-pack` from latest `main`.

## Status

- **Plans:** done
- **Impl:** not started
