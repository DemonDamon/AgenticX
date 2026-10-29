# K3-GraphDB G5 — Admin note + README + PR

> **Parent:** index · **Depends on:** G4
> **Do NOT start visualization UI.**

**Goal:** Document GraphStore as SoT; optional admin status shows store backend from sync stats; open PR.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/graphers/incremental/README.md` | GraphStore SoT + Neo4j env how-to |
| `enterprise/apps/admin-console/src/lib/graph-incremental-types.ts` | Optional `store_backend` on GraphStatsSnapshot |
| `enterprise/apps/admin-console/src/app/admin/_sections/graph-incremental.tsx` | Optional one-line backend status if present in stats |
| Index plan | Mark Done |

### Tasks

- [x] README: architecture (GraphStore SoT), env vars, FileGraphStore non-prod warning, viz deferred
- [x] Light admin note only (no viz)
- [x] Push branch; open PR (do not squash-merge)
- [x] Commit: `docs(knowledge): GraphStore SoT notes + admin backend status`

## Status

Done
