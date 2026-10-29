# K3 Admin A3 — Admin section UI + nav + i18n

**Goal:** `/admin/graph-incremental` under platform nav (数据治理域, next to knowledge-lifecycle), pattern = K2 list/detail + seed/sync actions.

**Files:**
- `…/_sections/graph-incremental.tsx` (`data-testid` prefix `graph-incremental-*`)
- Wire `admin-platform-sections.ts`, `[section]/page.tsx`, `AppShell.tsx`
- `messages/en.json` + `zh.json` keys `nav.items.graphIncremental` + `pages.admin.graphIncremental`
- Update `admin-platform-sections.test.ts`

**UI:**
- List sources + last sync status
- Detail: change set / extracted / published / trail-ish sync report
- Button to run seed sync / refresh

**Done when:** page loads with seeded list; select shows sync report detail; seed/sync buttons call API.

## Status

Done.
