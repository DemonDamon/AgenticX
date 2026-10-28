# AGX Data Suite P2-A7-2 — Mask on Board Bind Path

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a7-index.plan.md`

**Goal:** Optional masking before `bind_widget` / dataset reads so board series never leak raw sensitive fields for a role.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/dashboard/binder.py` | Optional `masking=` / `role=` on bind path |
| `agenticx/data_suite/dashboard/__init__.py` | Re-export if needed |
| `tests/data_suite/test_dashboard_mask_bind.py` | Bind with masking |

## Interfaces

```python
def bind_widget(
    store: DatasetStore,
    widget: WidgetSpec,
    *,
    filters: dict | None = None,
    masking: MaskingEngine | None = None,
    role: str | None = None,
) -> ChartSeries: ...
```

When `masking` and `role` set, mask dataset rows before filter/group/metric.

### Task 1

- [ ] Test: unmasked count vs masked drop changes series; partial does not change count metrics on other fields.
- [ ] Wire binder; keep default behavior when masking omitted.
- [ ] Commit: `feat(data-suite): apply masking on dashboard bind path`
