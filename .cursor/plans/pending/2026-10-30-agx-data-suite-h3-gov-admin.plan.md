# AGX Data Suite H3 — Governance admin 收口（清洗 / 分级 / 质量 / 审核）

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md`  
> **Branch:** `feat/agx-data-suite-h3-gov-admin`  
> **Depends on:** H1/H2 merged; **S2-6 dictionary/boards writable already done — DO NOT redo.**  
> **Main-repo gate:** 通用治理运营壳；禁止行业字典内容 / 客户质量阈值进引擎。

**Goal:** Extend admin data-governance from dictionary-only writable to also persist and operate:
1. **Cleaning rules** (ruleset CRUD → JSON store; can drive `CleaningEngine`)
2. **Classification / trust grades** (configurable grade list; default seed S/A/B/C — names configurable, not business content)
3. **Quality pipeline metrics** (metric defs CRUD; trigger one `QualityRollup.compute_day` run and persist snapshot)
4. **Review / audit actions** on quarantine items (approve/reject/keep; append-only audit log)

Reuse `store/file_store` + admin `data-suite-store.ts` patterns. Dictionary & boards APIs untouched except shared store helpers if needed.

**Out of scope:** Redoing dictionary/boards CRUD; portal; Postgres migration; customer tag dictionaries; H4 auth; A9.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/store/file_store.py` | Add `CleaningRuleStore`, `ClassificationStore`, `QualityMetricStore`, `ReviewActionStore` (or one `GovernanceOpsStore` with 4 JSON files) |
| `tests/data_suite/test_file_store.py` | Extend CRUD+persist tests for new entities |
| `tests/data_suite/test_governance_ops_run.py` | Optional: load rules from store → CleaningEngine / QualityRollup one-shot |
| `enterprise/apps/admin-console/src/lib/data-suite-store.ts` | Mirror new JSON files + seed minimal generic samples (no customer names) |
| `enterprise/apps/admin-console/src/lib/__tests__/data-suite-store.test.ts` | Vitest for new entities |
| `enterprise/apps/admin-console/src/lib/data-suite-types.ts` | Types |
| `enterprise/apps/admin-console/src/app/api/admin/data-suite/cleaning-rules/route.ts` | GET list + PUT upsert |
| `.../classification/route.ts` | GET + PUT grades |
| `.../quality-metrics/route.ts` | GET + PUT; POST `/run` for one day rollup stub |
| `.../review-actions/route.ts` | GET audit + POST action |
| `enterprise/apps/admin-console/src/app/admin/_sections/data-governance.tsx` | UI sections/tabs for 4 entities (keep dictionary working) |
| `enterprise/scripts/e2e-data-governance.ts` | Extend: upsert one cleaning rule, one grade, one quality metric, one review action; screenshot |

## Store shapes (generic)

```json
// cleaning_rules.json
{ "rules": [ { "id", "template", "field", "params", "enabled" } ] }

// classification.json
{ "grades": [ { "id", "label", "rank" } ] }  // seed S/A/B/C with ranks 4..1

// quality_metrics.json
{ "metrics": [ { "id", "type", "field" } ], "last_run": null | { "day", "metrics", "meta" } }

// review_actions.json
{ "actions": [ { "id", "target_rule_id", "decision", "note", "at" } ] }
```

Auth scopes: same as S2-6 (`provider:read` / `provider:update`).

## Tasks

### Task 1 — Python stores + tests (TDD)
- [x] Extend file_store + test_file_store for 4 entities; optional ops-run test wiring CleaningEngine/QualityRollup from store
- [x] Commit: `feat(data-suite): governance ops file stores (cleaning/classification/quality/review)`

### Task 2 — Admin store + API routes + vitest
- [x] TS store + routes + tests
- [x] Commit: `feat(admin): data-suite governance ops writable APIs`

### Task 3 — UI + e2e
- [x] Wire data-governance.tsx sections with data-testid hooks
- [x] Extend e2e-data-governance.ts; run if admin can start, else document + ensure vitest+pytest green and e2e script typechecks
- [x] Prefer: start admin-console briefly and run e2e if feasible on Mac; if blocked on login/env, still ship with pytest+vitest green and e2e script ready
- [x] Commit: `feat(admin): wire governance ops UI + extend e2e`

### Task 4 — Gate + PR
- [x] `pytest tests/data_suite/test_file_store.py tests/data_suite/test_governance_*.py -v --override-ini='addopts='`
- [x] `pytest tests/data_suite/ -v --override-ini='addopts='` green
- [x] vitest data-suite-store tests green
- [x] Mark plan Done; push; `gh pr create`
- [x] **Do not start H4**

## Done when
1. Four new entities CRUD persist across reload (JSON files)
2. Dictionary/boards S2-6 behavior unchanged / still green
3. Quality POST run produces `last_run` snapshot (can use tiny in-memory/fixture rows)
4. e2e script covers new testids (executed if admin up; otherwise script ready + unit gates green)
5. No customer/industry dictionary content; no FinnewsHunter commits

## Gate before H4
Merge this PR (or user stacks) before H4 auth registry work on a fresh branch from main.
