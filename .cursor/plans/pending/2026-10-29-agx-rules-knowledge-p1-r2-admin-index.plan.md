# AGX Rules & Knowledge P1 — R2 Admin UI Index（消歧 choice-panel）

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md`
> **Depends on:** R2 library on `main`; K2 admin UI merged (PR #147, `cdb601d1`).
> **Prior UI pattern:** rule-governance + knowledge-lifecycle.
> Execute sequentially: A1 → A4. No A9. Brand-A only. Leave unrelated dirty untouched.

**Goal:** Admin-console choice-panel for disambiguation sessions covering `candidate_select` / `info_supplement` / `conflict_resolve`, wired to protocol-shaped JSON store.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| A1 | `2026-10-29-agx-rules-knowledge-p1-r2-admin-1-store.plan.md` | Types + store + vitest |
| A2 | `2026-10-29-agx-rules-knowledge-p1-r2-admin-2-apis.plan.md` | Writable APIs |
| A3 | `2026-10-29-agx-rules-knowledge-p1-r2-admin-3-ui.plan.md` | Section + nav + i18n |
| A4 | `2026-10-29-agx-rules-knowledge-p1-r2-admin-4-e2e.plan.md` | Playwright + HD shots 07–09; PR ready |

## Branch

`feat/agx-rules-knowledge-p1-r2-admin-ui`

## Status

- **Plans:** all A1–A4 Done
- **Impl:** merged to `main` via PR #148 (`44d6c050`, 2026-10-29 Asia/Shanghai); HD shots 07–09 on main
- **Follow-up:** P0 debt cleanup on `fix/agx-rules-knowledge-p0-debt`

