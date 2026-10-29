# K2 Admin A1 — Types + file store + quality helper

**Goal:** Mirror `agenticx/knowledge/lifecycle` JSON shapes in admin-console TS: seed Brand-A samples, list/upsert/transition objects, issues + trail, minimal quality checks → open issues.

**Files:**
- `enterprise/apps/admin-console/src/lib/knowledge-lifecycle-types.ts`
- `enterprise/apps/admin-console/src/lib/knowledge-lifecycle-store.ts`
- `enterprise/apps/admin-console/src/lib/knowledge-lifecycle-quality.ts`
- `enterprise/apps/admin-console/src/lib/__tests__/knowledge-lifecycle-store.test.ts`

**Store dir:** `AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR` else `../../.runtime/admin/knowledge-lifecycle` from cwd.

**Done when:** vitest for store/transitions/issues/quality green; seeds use `brand-a-*` only.

## Status

Done.
