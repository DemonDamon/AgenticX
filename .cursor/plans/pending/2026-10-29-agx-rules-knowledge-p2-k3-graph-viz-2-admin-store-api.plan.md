# K3-GraphViz V2 — Admin GraphStore read API + Brand-A seed

> **Parent:** index · **Depends on:** V1

**Goal:** Admin APIs that read nodes/edges/stats via a GraphStore-shaped store (memory/file local; Neo4j when `NEO4J_URI` / bridge).

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/apps/admin-console/src/lib/graph-store-types.ts` | Node/edge/subgraph DTOs + Brand-A sample graph |
| `enterprise/apps/admin-console/src/lib/graph-store.ts` | Memory/File GraphStore + factory + seed |
| `enterprise/apps/admin-console/src/app/api/admin/graph-explorer/stats/route.ts` | GET stats + backend |
| `enterprise/apps/admin-console/src/app/api/admin/graph-explorer/subgraph/route.ts` | GET subgraph |
| `enterprise/apps/admin-console/src/app/api/admin/graph-explorer/neighborhood/route.ts` | GET neighborhood `?id=` |
| `enterprise/apps/admin-console/src/app/api/admin/graph-explorer/seed/route.ts` | POST Brand-A seed into GraphStore |
| `enterprise/apps/admin-console/src/lib/__tests__/graph-store.test.ts` | vitest |

### Tasks

- [x] Types + store + seed Brand-A entities/rels
- [x] API routes; backend label in every response
- [x] vitest green
- [x] Commit: `feat(admin): GraphStore-backed graph-explorer read APIs`

## Status

Done
