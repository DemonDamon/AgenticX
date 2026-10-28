# AGX Data Suite P1-A6-4 — Admin Board UI + E2E

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p1-a6-index.plan.md`
> After A6-3.

**Goal:** admin-console `/admin/data-boards` renders sample board from embedded fixture (mirrors YAML); vitest + browser e2e prove config→UI→drill/compare.

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/.../admin/_sections/data-boards.tsx` | Board page |
| `enterprise/.../lib/data-board-fixture.ts` | Typed fixture = sample_board + series |
| AppShell / platform-sections / messages zh+en | Nav + i18n |
| vitest: platform-sections + section smoke | Registration |
| `docs/agx-data-suite/shots/` or `/tmp` smoke notes | Browser e2e evidence |

### Task 1 — UI

- [x] Section lists board title + widgets; drill buttons call client-side filter on fixture rows; compare toggle shows A/B labels.
- [x] Register `data-boards` in platform sections + NAV_GROUPS + i18n.
- [x] Vitest: section id registered; fixture has ≥1 widget.

### Task 2 — E2E

- [x] Ensure admin-console running locally (or start it).
- [x] Browser: login `admin@agenticx.local` → open Data Boards → assert board title visible; assert chart/stat content; click drill; toggle compare.
- [x] Commit: `feat(admin): data-boards page with drill/compare e2e fixture`

## E2E checklist

- [x] pytest dashboard_* green
- [x] vitest platform-sections includes data-boards
- [x] browser smoke logged (screenshot path under docs/agx-data-suite/shots/)
