# AGX Data Suite P2-A7-3 — Page Watermark

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a7-index.plan.md`

**Goal:** Reusable page watermark overlay (user + timestamp text), mounted for smoke in admin-console and web-portal root layout behind content (pointer-events none).

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/apps/admin-console/src/components/PageWatermark.tsx` | Component |
| `enterprise/apps/admin-console/src/components/__tests__/PageWatermark.test.tsx` | Vitest |
| `enterprise/apps/admin-console/src/components/AppShell.tsx` | Mount when env/flag or always in dev fixture text |
| `enterprise/apps/web-portal/src/components/PageWatermark.tsx` | Portal copy (same API) |
| `enterprise/apps/web-portal/src/app/layout.tsx` | Mount |

Props: `text: string`, `testId?: string` default `page-watermark`.

### Task 1

- [ ] Vitest: renders text + `data-testid=page-watermark`.
- [ ] Mount admin AppShell with `process.env.NEXT_PUBLIC_PAGE_WATERMARK` or fallback `demo@agenticx.local`.
- [ ] Mount portal layout similarly.
- [ ] Commit: `feat(enterprise): page watermark overlay for admin and portal`
