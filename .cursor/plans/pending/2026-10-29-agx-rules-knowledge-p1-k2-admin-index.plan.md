# AGX Rules & Knowledge P1 — K2 Admin UI Index（数据治理）

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md`
> **Depends on:** K2 library on `main` (`agenticx/knowledge/lifecycle/`, tip includes P1 R2 `2f31b32e`).
> **Prior UI pattern:** `rule-governance` + `enterprise/scripts/e2e-rule-governance.ts` + writable `data-suite` dictionary APIs.
> Execute sequentially: A1 → A4. No parallel. No A9. Desensitize (Brand-A / synthetic only). Leave unrelated dirty files untouched.

**Goal:** Land admin-console **「数据治理」域** knowledge-lifecycle pages: object list/detail, status transitions, quality issues + handling, change trail — backed by JSON file store mirroring the Python package schemas (`objects.json` / `issues.json` / `changes.json`).

**A/B:** Admin UI + TS store/API in AgenticX trunk. No domain ontology, no customer names.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| A1 | `…-k2-admin-1-store.plan.md` | Types + file store + quality helper + vitest green |
| A2 | `…-k2-admin-2-apis.plan.md` | Writable `/api/admin/knowledge-lifecycle/*` routes |
| A3 | `…-k2-admin-3-ui.plan.md` | Section page + nav + i18n (en/zh) |
| A4 | `…-k2-admin-4-e2e.plan.md` | Playwright e2e + HD shots + README; index complete |

## E2E gate

1. `pnpm -C enterprise/apps/admin-console test` covers knowledge-lifecycle store.
2. Playwright script exits 0; HD shots under `docs/agx-rules-knowledge-suite/e2e-shots/`.
3. No real customer identifiers in seeds/fixtures/shots captions.

## Branch

`feat/agx-rules-knowledge-p1-k2-admin-ui` from latest `main`.

## Status

- **Plans:** all A1–A4 Done
- **Impl:** complete on `feat/agx-rules-knowledge-p1-k2-admin-ui` (awaiting PR merge)
