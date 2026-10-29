# K3-GraphViz V4 — Align graph-incremental with GraphStore SoT display

> **Parent:** index · **Depends on:** V2

**Goal:** Reduce #158 debt — admin sync demo must not pretend JSON alone is graph SoT. Seed/sync writes Brand-A into GraphStore and surfaces `store_backend`.

## File map

| Path | Responsibility |
|------|----------------|
| `graph-incremental-store.ts` | On seed/mock sync: upsert into GraphStore; set `graph_stats.store_backend` from store.stats() |
| `graph-incremental.tsx` | Copy: backend is publish SoT; link to graph-explorer |
| tests | Update vitest expectations |

### Tasks

- [ ] Seed/sync populate GraphStore + honest store_backend
- [ ] UI note / link; remove “viz deferred” dead copy
- [ ] Commit: `fix(admin): align graph-incremental seed/sync with GraphStore SoT`

## Status

Pending
