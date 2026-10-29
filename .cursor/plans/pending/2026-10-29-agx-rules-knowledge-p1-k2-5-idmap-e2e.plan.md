# AGX Rules & Knowledge P1 — K2-5 Idmapping hook + closed-loop e2e

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-k2-index.plan.md`
> **Depends on:** K2-1…K2-4

**Goal:** Optional adapter that feeds multi-source `source_ids` / attrs through `data_suite/idmapping` merge+conflict surfaces into KnowledgeObject upserts; ship a library closed-loop e2e (ingest → quality → issues → review → publish/retire) + short README. Admin UI out of scope unless separately planned.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/lifecycle/idmap_hook.py` | `ingest_with_idmapping(...)` thin adapter |
| `agenticx/knowledge/lifecycle/README.md` | Lifecycle + quality + issue loop sample |
| `tests/knowledge/lifecycle/test_lifecycle_e2e.py` | Full closed loop with trail + issues |
| `tests/knowledge/lifecycle/test_idmap_hook.py` | Conflict → finding / issue path |

## Done criteria

1. Multi-source synthetic objects ingest; idmapping conflicts surface as quality/issues (or explicit hook result).
2. Happy path: draft → quality clean (or issues waived) → pending_review → published → retired; trail entries present.
3. `pytest tests/knowledge/lifecycle/ -q` green; index Status marked complete.
4. Commit: `feat(knowledge): knowledge lifecycle idmap hook and e2e`

## Status

Done on `feat/agx-rules-knowledge-p1-k2`.
