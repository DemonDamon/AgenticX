# R2 Portal P1 — runtime store + types

## Goal
Protocol-shaped TS types + JSON file store for **runtime** sessions (mirrors `agenticx.runtime.disambiguation`, separate from admin store).

## Deliverables
- `enterprise/apps/web-portal/src/lib/disambiguation-types.ts` — three modes; Brand-A samples
- `enterprise/apps/web-portal/src/lib/disambiguation-runtime-store.ts` — list/get/upsert/applyResponse/reseed; default runtime dir
- `enterprise/apps/web-portal/src/lib/__tests__/disambiguation-runtime-store.test.ts`

## Done when
Vitest green; Brand-A samples; path ≠ admin store.

## Status
Done.
