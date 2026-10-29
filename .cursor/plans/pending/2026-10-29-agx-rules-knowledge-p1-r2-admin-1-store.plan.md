# R2 Admin A1 — store + types

## Goal
Protocol-shaped TypeScript types + JSON file store under `AGX_DISAMBIGUATION_STORE_DIR` (default `enterprise/.runtime/admin/disambiguation`), mirroring `agenticx/runtime/disambiguation`.

## Deliverables
- `src/lib/disambiguation-types.ts` — modes `candidate_select` | `info_supplement` | `conflict_resolve`; Brand-A sample sessions
- `src/lib/disambiguation-store.ts` — list/get/upsert/create/applyResponse/reseedSamples + validators
- `src/lib/__tests__/disambiguation-store.test.ts` — vitest for three modes

## Done when
Vitest green for store; samples load without Python runtime.

## Status
Done.
