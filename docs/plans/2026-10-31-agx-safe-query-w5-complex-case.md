# W5 Executable Subplan — 复杂案例夹具

> Depends: W1–W4 interface freeze  
> Branch: `feat/agx-safe-query-w5-case`

## Goal
「华东零售 · 月度经营问数 + 知识图核验」fixtures + API orchestration pytest.

## Steps
- [x] Seed Chinese dictionary/channel/knowledge drafts
- [x] Script/pytest: explain → execute → publish → neighborhood asserts
- [x] One-command or single pytest entry for CI/Mac

## Case
- Question: `上月华东大区 GMV 和退货率分别是多少？`
- Knowledge: ≥2 entities + ≥1 relationship, Chinese attrs
- Channel: in-memory `FakeQueryChannel` (no external Hive)

## Run (Mac / CI)

```bash
pytest tests/safe_query/test_w5_east_china_retail_complex_case.py -q
```

Fixtures live under `tests/safe_query/fixtures/east_china_retail/` (not under `agenticx/` — no customer B-pack).

## Done when
API-level closed loop reproducible without UI.
