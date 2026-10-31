# Safe-query W6 copper-pipe — A1–A6 checklist

> Date: 2026-10-31 (Asia/Shanghai)  
> Branch: `feat/agx-safe-query-w6-e2e` (W4 UI + W5 fixtures + W3 facade)  
> Admin: W4 worktree `AgenticX-w4` on `http://127.0.0.1:3001`  
> Author evidence: DemonDamon

## Summary

| # | Assertion | Status | Evidence |
|---|-----------|--------|----------|
| A1 | Write-gate denial stable / measurable | **PASS** | Playwright UI + W5 pytest + API JSON + nl2sql_cli |
| A2 | Explain mode: no execute, SQL draft only | **PASS** | Playwright UI shot + W5 pytest + API JSON + CLI |
| A3 | After confirm, read-only execute shows rows | **PASS** | Playwright UI shot + W5 pytest + API JSON + CLI |
| A4 | Review→publish→neighborhood/subgraph | **PASS** | W5 pytest + API JSON; **UI**: publish `device-pump-01` → 查看邻域 → `/admin/graph-explorer?focus=…` with Chinese neighborhood (`07-neighborhood-ui.png`, `08-neighborhood-pump01.png`) |
| A5 | Secondary side-effect failure → warnings, not fake success | **PASS** | W5 pytest + `api-cli-closed-loop.json` warnings |
| A6 | No new query dialect / no second GraphStore SoT / no customer pack in `agenticx/` | **PASS** | Diff review on stack vs main merge-base |

## A4 UI close-out (this turn)

Previously: knowledge list had published seed `site-cooling-zone-1`, but Playwright did not select the published row, and graph-explorer Neo4j bridge 500'd (`python3` cwd was `enterprise/` → `No module named agenticx`).

Fixed:

1. Hotfix `graph-store.ts` / `nl2sql-admin.ts`: resolve repo root as `../../..` from `apps/admin-console`, inject `PYTHONPATH`.
2. Restart admin with `AGX_PYTHON=/opt/miniconda3/bin/python3` + `AGX_REPO_ROOT`.
3. Playwright `e2e-safe-query-a4-neighborhood.ts`: seed Brand-A graph → UI transition draft→published on `device-pump-01` → open published site → **查看邻域** → assert Chinese neighborhood nodes.

| File | What it proves |
|------|----------------|
| `07a-graph-seed.png` | GraphStore seed (neo4j) |
| `07b-after-publish-pump01.png` | UI publish path + 查看邻域 link |
| `07c-published-with-neighborhood-link.png` | Published site detail with link |
| `07-neighborhood-ui.png` | Landed `?focus=site-cooling-zone-1`, neighborhood lists 1号循环泵 / 回路切断阀 / 一车间冷却区 |
| `08-neighborhood-pump01.png` | Published pump neighborhood |
| `a4-neighborhood-ui-results.json` | Machine-readable A4 UI pass |

## Commands run

```bash
# W5 API closed loop
PYTHONPATH=/Users/damon/myWork/AgenticX-w4 \
  python3 -m pytest tests/safe_query/test_w5_east_china_retail_complex_case.py -q -o addopts=

# API/CLI click-equivalent
PYTHONPATH=/Users/damon/myWork/AgenticX-w4 \
  python3 docs/agx-data-suite/shots/safe-query-e2e/run_api_cli_evidence.py

# Playwright A1–A3 (+ earlier partial A4)
pnpm -C enterprise exec tsx scripts/e2e-safe-query-nl2sql.ts

# Playwright A4 UI close-out
pnpm -C enterprise exec tsx scripts/e2e-safe-query-a4-neighborhood.ts
# → a4_ui_pass: true

# Official enterprise/e2e package still needs E2E_MODEL_* (not claimed green)
```

## Residual / notes

1. Official `enterprise/e2e` runner still blocked without `E2E_MODEL_*` — copper-pipe uses sibling Playwright `tsx` scripts instead.
2. Admin GraphStore Neo4j bridge requires `AGX_PYTHON` pointing at an interpreter that can import `agenticx` (or rely on the cwd/`PYTHONPATH` hotfix). System `/usr/bin/python3` alone is insufficient.
3. No W7 Feishu handbook work in this PR.
