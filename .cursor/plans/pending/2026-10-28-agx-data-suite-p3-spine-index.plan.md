# AGX Data Suite P3-Spine — Golden Path Index

> **Parent roadmap:** `.cursor/plans/pending/2026-10-28-agx-data-suite-after-a8-roadmap.plan.md` (Track 1)
> **Depends on:** A1–A8 on branch `feat/agx-data-suite-p2-a8` (A8 may still be unmerged; spine branch forks from it).
> Execute sequentially: S1-1 → S1-5. No parallel sub-agents.

**Goal:** One desensitized end-to-end demo that chains A1–A8 into a single story:

`FakeChannel probe → DataFlow job → OneID → dictionary/quality → tags/audience → config board → masking → A8 patrol webhook`

**Deliverable layout:**
- `examples/data_suite/golden_path/` — seed YAML/JSON + `run_golden_path.py` (one README command)
- `tests/data_suite/test_golden_path_e2e.py` — pytest gate for the whole spine
- Docs: README in example + shot index note under `docs/agx-data-suite/`

**Tech:** Python 3.10+, pytest, PyYAML; reuse existing `agenticx/data_suite/*` + `agenticx/managed/templates/data_suite/*`. No customer names. No new lakehouse / A9 compute.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| S1-1 | `2026-10-28-agx-data-suite-p3-spine-1-scaffold-seed.plan.md` | Package + seed rows + FakeChannel probe green |
| S1-2 | `2026-10-28-agx-data-suite-p3-spine-2-job-oneid.plan.md` | Job DSL run + IdMappingEngine on seed → dst rows |
| S1-3 | `2026-10-28-agx-data-suite-p3-spine-3-gov-tags.plan.md` | Dictionary/quality + tag compute + audience select on same seed |
| S1-4 | `2026-10-28-agx-data-suite-p3-spine-4-board-mask.plan.md` | Board bind + MaskingEngine on export rows; watermark documented for admin |
| S1-5 | `2026-10-28-agx-data-suite-p3-spine-5-patrol-e2e-readme.plan.md` | A8 quality/dict tick webhooks + one-command README + full pytest gate |

## E2E gate (whole S1)

1. `pytest tests/data_suite/test_golden_path_e2e.py -q` green.
2. `python examples/data_suite/golden_path/run_golden_path.py` exits 0 and prints a short stage summary.
3. No customer / company / proposal identifiers in tree under `examples/data_suite/golden_path/`.

## Branch

`feat/agx-data-suite-p3-spine` from current A8 tip (includes A8 templates until A8 merges).

## Status

- **Plans:** writing
- **Impl:** not started
