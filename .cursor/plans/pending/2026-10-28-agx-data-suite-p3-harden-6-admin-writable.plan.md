# AGX Data Suite P3-Harden-6 — Governance / Boards minimal writable API

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-harden-index.plan.md`  
> **Branch:** `feat/agx-data-suite-p3-spine`  
> **Roadmap:** Track 2 item 3 — fixture → 最小可写 API + 文件仓持久化

**Goal:** Dictionary fields and board specs can be listed and upserted via admin API, persisted under a runtime JSON file store (same pattern as `gateway-cache-store.ts`). Python A-layer gets a matching file store for offline tests / golden path. UI sections read from API instead of hard-coded SAMPLE_* only.

**Out of scope:** full postgres schema migration; portal self-serve; rich form UX; Hive/file channels; A9.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/store/__init__.py` | Exports |
| `agenticx/data_suite/store/file_store.py` | `DictionaryFileStore`, `BoardFileStore` (JSON path) |
| `tests/data_suite/test_file_store.py` | CRUD + persistence roundtrip |
| `enterprise/apps/admin-console/src/lib/data-suite-store.ts` | File JSON store + seed defaults |
| `enterprise/apps/admin-console/src/lib/__tests__/data-suite-store.test.ts` | Vitest with temp dir |
| `enterprise/apps/admin-console/src/app/api/admin/data-suite/dictionary/route.ts` | GET list + PUT upsert fields |
| `enterprise/apps/admin-console/src/app/api/admin/data-suite/boards/route.ts` | GET list + POST create |
| `enterprise/apps/admin-console/src/app/api/admin/data-suite/boards/[id]/route.ts` | GET one + PUT update |
| `enterprise/apps/admin-console/src/app/admin/_sections/data-governance.tsx` | Fetch dictionary; simple upsert |
| `enterprise/apps/admin-console/src/app/admin/_sections/data-boards.tsx` | Load board spec from API (fallback fixture) |

## Store shape

```json
// dictionary.json
{ "fields": [ { "name", "business_def", "calc_logic", "update_freq", "owner" } ] }

// boards.json
{ "boards": [ { "id", "title", "drillLevels", "widgets": [...] } ] }
```

Path: `process.env.AGX_DATA_SUITE_STORE_DIR` or `../../.runtime/admin/data-suite/` from admin-console cwd. Python: `AGX_DATA_SUITE_STORE_DIR` or tempfile in tests.

Auth: `requireAdminScope(["provider:read"])` for GET; `["provider:update"]` for writes (match capability-packs).

Seed: first read copies SAMPLE_FIELDS / SAMPLE_BOARD when file missing.

## Tasks

### Task 1 — Python file store (TDD)
- [ ] `test_file_store.py`: upsert field, list, persist reload; upsert board by id
- [ ] Implement `file_store.py`
- [ ] Commit: `feat(data-suite): JSON file store for dictionary and boards`

### Task 2 — Admin store + API routes (TDD)
- [ ] Vitest for data-suite-store read/write with tmp dir env
- [ ] Implement store + three routes
- [ ] Commit: `feat(admin): data-suite dictionary/boards writable file API`

### Task 3 — Wire UI sections
- [ ] Governance: load fields from GET; form to PUT one field; show stubNote only on error
- [ ] Boards: GET boards, use first or sample_member_board; keep drill/compare UX
- [ ] Commit: `feat(admin): wire data-governance/boards UI to writable API`

### Task 4 — Gate
- [ ] `pytest tests/data_suite/test_file_store.py -v --override-ini='addopts='`
- [ ] `pnpm --filter admin-console exec vitest run src/lib/__tests__/data-suite-store.test.ts` (or package's test script path)
- [ ] Existing data-board-fixture + data_suite pytest still green
- [ ] Update harden index; commit docs

## Done when
1. PUT dictionary field survives process restart (file on disk)
2. GET/PUT boards API roundtrips
3. Admin sections no longer solely hard-code SAMPLE (API primary, fixture seed OK)
4. No customer names; no push
