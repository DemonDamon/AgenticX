# AGX Rules & Knowledge P1 — R2 Portal choice-panel Index

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md`
> **Depends on:** R2 library + admin R2 (#148) on `main`. Do **not** stack on K3 admin (#153).
> Execute sequentially: P1 → P4. No A9. Brand-A only. Leave unrelated dirty untouched.

**Goal:** Web-portal / Near runtime surface for `candidate_select` / `info_supplement` / `conflict_resolve`, consuming **runtime** disambiguation sessions (`.runtime/disambiguation`, not admin JSON store).

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| P1 | `2026-10-29-agx-rules-knowledge-p1-r2-portal-1-store.plan.md` | Types + runtime store + vitest |
| P2 | `2026-10-29-agx-rules-knowledge-p1-r2-portal-2-apis.plan.md` | Portal writable APIs |
| P3 | `2026-10-29-agx-rules-knowledge-p1-r2-portal-3-ui.plan.md` | Choice-panel + `/workspace/disambiguation` mount + i18n |
| P4 | `2026-10-29-agx-rules-knowledge-p1-r2-portal-4-e2e.plan.md` | Unit/e2e green; PR open |

## Branch

`feat/agx-rules-knowledge-p1-r2-portal-choice-panel`

## Mount

Primary: authenticated page `enterprise/apps/web-portal` → `/workspace/disambiguation`.
Reusable panel: `DisambiguationChoicePanel` (same three-mode UX as admin).
Settings → General includes an entry link.
Store: `AGX_DISAMBIGUATION_RUNTIME_STORE_DIR` (default `../../../.runtime/disambiguation` from web-portal cwd) — **not** `.runtime/admin/disambiguation`.

## Status

- **Plans:** P1–P4 Done
- **Tests:** `pnpm -C enterprise/apps/web-portal exec vitest run src/lib/__tests__/disambiguation-runtime-store.test.ts` → 7 passed
- **E2E:** `enterprise/scripts/e2e-portal-disambiguation.ts` (optional when portal :3000 + login available; shots 13–15)
