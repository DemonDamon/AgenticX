# AGX Rules & Knowledge P1 — R2-5 Dual-path e2e + README

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-r2-index.plan.md`
> **Depends on:** R2-1…R2-4

**Goal:** Closed-loop e2e proving rules NL and retrieval object paths share one protocol; short README; mark admin/UI deferred. Optional thin re-export from `runtime/__init__.py`.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/runtime/disambiguation_README.md` or section in module docstring + `docs/agx-rules-knowledge-suite/disambiguation-protocol.md` | Protocol overview + sample |
| `tests/runtime/disambiguation/test_dual_path_e2e.py` | Rules + retrieval both use DisambiguationRequest/Session |
| `agenticx/runtime/__init__.py` | Re-export key types (lazy or direct) |

## Done criteria

1. E2E: ambiguous NL → session → answers → Rule draft; multi-hit retrieval → session → pick → ObjectHit; assert same mode enum / request schema.
2. README documents three modes, A/B boundary, **Admin/UI deferred** (no portal/admin e2e or HD shots in this PR).
3. `pytest tests/runtime/disambiguation/ tests/rules/test_nl_disambiguation.py tests/retrieval/test_object_disambiguation.py -q` green.
4. Index Status marked complete.
5. Commit: `feat(runtime): disambiguation dual-path e2e and docs`

## UI gate

**Deferred.** Suite landing is runtime protocol + agent interaction shape; no admin-console / web-portal pages in R2. Future slice may add choice-panel UI akin to rule-governance.

## Status

Pending.
