# K2 Admin A3 — Admin section UI + nav + i18n

**Goal:** `/admin/knowledge-lifecycle` under platform nav (数据治理域), pattern = rule-governance list/detail + writable transition/issue actions.

**Files:**
- `…/_sections/knowledge-lifecycle.tsx` (`data-testid` prefix `knowledge-lifecycle-*`)
- Wire `admin-platform-sections.ts`, `[section]/page.tsx`, `AppShell.tsx`
- `messages/en.json` + `zh.json` keys `nav.knowledgeLifecycle` + `pages.admin.knowledgeLifecycle`
- Update `admin-platform-sections.test.ts`

**Done when:** page loads with seeded list; select shows detail/issues/trail; transition buttons call API.

## Status

Done.
