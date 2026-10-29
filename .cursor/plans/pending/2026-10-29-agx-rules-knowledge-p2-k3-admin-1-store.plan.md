# K3 Admin A1 — Types + file store + Brand-A seed

**Goal:** Mirror `agenticx/knowledge/graphers/incremental` JSON shapes in admin-console TS: sources/fingerprints, ChangeSet-like rows, SyncReport runs (`to_dict` fields), source→object index, optional graph stats snapshot; seed Brand-A sources + one full sync + one incremental (unchanged skipped).

**Files:**
- `enterprise/apps/admin-console/src/lib/graph-incremental-types.ts`
- `enterprise/apps/admin-console/src/lib/graph-incremental-store.ts`
- `enterprise/apps/admin-console/src/lib/__tests__/graph-incremental-store.test.ts`

**Store dir:** `AGX_GRAPH_INCREMENTAL_ADMIN_STORE_DIR` else `../../.runtime/admin/graph-incremental` from cwd.

**Persistence files (under store dir):**
- `sources.json` — `{ sources: SourceDocumentRow[] }`
- `fingerprints.json` — `{ fingerprints: Record<sourceId, hash> }`
- `sync_runs.json` — `{ runs: SyncReportRow[] }`
- `source_index.json` — `{ links: Record<sourceId, objectId[]> }`
- `graph_stats.json` — optional snapshot `{ entity_count, relation_count, updated_at, ... }`

**Done when:** vitest for seed / list / mock sync / index green; seeds use `brand-a-*` only.

## Status

Done.
