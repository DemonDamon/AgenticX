# AGX Data Suite P3-Spine-4 — Board Bind + Masking

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-spine-index.plan.md`

**Goal:** Bind a config board to golden-path dataset and apply MaskingEngine on exported widget rows. Document admin PageWatermark env for demo shots (no new React unless already trivial).

## File map

| Path | Responsibility |
|------|----------------|
| `examples/data_suite/golden-path/seed/board.yaml` | BoardSpec (bar/donut/stat) on `members` dataset |
| `examples/data_suite/golden-path/seed/masking.yaml` | Mask phone/email partial|hash |
| `examples/data_suite/golden-path/board_stage.py` | DatasetStore + bind_widget + mask export |
| `tests/data_suite/test_golden_path_board_mask.py` | Bound series non-empty; masked PII not raw |
| README note (stub OK) | `NEXT_PUBLIC_PAGE_WATERMARK` for admin watermark |

## Interfaces

```python
def run_board_stage(rows, *, board_yaml, masking_yaml) -> dict:
    """Return {"widgets": [...], "masked_sample": dict} with PII masked."""
```

Watermark: admin already has `PageWatermark`; spine only documents env var — S1-5 README + optional shot.

### Task 1

- [ ] Failing test: raw email in rows; after mask, export sample email != raw.
- [ ] Implement board/masking seed + board_stage.
- [ ] Commit: `feat(data-suite): golden-path board bind + masking stage`
