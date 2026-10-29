# AGX Rules & Knowledge P2 — K3 Admin UI Index（图谱增量）

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md`
> **Depends on:** K3 library on `main` (`agenticx/knowledge/graphers/incremental/`, tip `d97ce248`).
> **Prior UI pattern:** K2 admin (`knowledge-lifecycle`) + R2 admin (`disambiguation`) + writable data-suite APIs.
> Execute sequentially: A1 → A4. No parallel. No A9. Desensitize (Brand-A / synthetic only). Leave unrelated dirty files untouched. Local Mac only (cloud agents region-blocked).

**Goal:** Land admin-console **「数据治理」域** graph-incremental pages: source list + last sync status, sync-run detail (change set / extracted / published / trail-ish report), seed/mock sync — backed by JSON file store mirroring the Python K3 shapes (`fingerprints` / `sources` / `sync_runs` / `source_index`).

**A/B:** Admin UI + TS store/API in AgenticX trunk. No domain ontology, no customer names. No portal choice-panel in this slice.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| A1 | `…-k3-admin-1-store.plan.md` | Types + file store + Brand-A seed + vitest green |
| A2 | `…-k3-admin-2-apis.plan.md` | Writable `/api/admin/graph-incremental/*` routes |
| A3 | `…-k3-admin-3-ui.plan.md` | Section page + nav + i18n (en/zh) |
| A4 | `…-k3-admin-4-e2e.plan.md` | Playwright e2e + HD shots 10–12 + README; index complete |

## E2E gate

1. `pnpm -C enterprise/apps/admin-console exec vitest run src/lib/__tests__/graph-incremental-store.test.ts` green.
2. Playwright script exits 0; HD shots under `docs/agx-rules-knowledge-suite/e2e-shots/` (10–12).
3. No real customer identifiers in seeds/fixtures/shots captions.

## Branch

`feat/agx-rules-knowledge-p2-k3-admin-ui` from latest `main`.

## Status

- **Plans:** all A1–A4 Done
- **Impl:** on `feat/agx-rules-knowledge-p2-k3-admin-ui` (vitest + e2e green; PR open)
- **Library index:** Admin UI landed — see this index
