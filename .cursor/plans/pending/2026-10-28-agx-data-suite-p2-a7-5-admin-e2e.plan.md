# AGX Data Suite P2-A7-5 — Admin Data-Security + E2E

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a7-index.plan.md`

**Goal:** Admin `/admin/data-security` shows sample masking before/after for a role + watermark on shell; Playwright e2e green.

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/apps/admin-console/src/app/admin/_sections/data-security.tsx` | UI stub |
| `enterprise/apps/admin-console/src/lib/data-security-fixture.ts` | Fixture rows + masked preview (can call static JSON mirror of Python sample) |
| `enterprise/apps/admin-console/src/lib/admin-platform-sections.ts` | Register section |
| `enterprise/apps/admin-console/messages/{zh,en}.json` | i18n |
| `enterprise/scripts/e2e-data-security.ts` | Playwright |
| `enterprise/package.json` | `e2e:data-security` script |

### Task 1

- [ ] Section lists policy id + shows masked phone for role `analyst`.
- [ ] Watermark testid present on page.
- [ ] Vitest fixture + platform-sections.
- [ ] Playwright: login → data-security → assert masked value + watermark.
- [ ] Commit: `feat(admin): data-security section and e2e for A7`
