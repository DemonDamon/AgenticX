# AGX Rules & Knowledge Suite P1 — K2 Index (Knowledge Lifecycle)

> **Parent roadmap:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md`
> **Depends on:** P0 R1+K1 on `main` (PR #144, sha `b7ff1e8c`). Requirement background: `docs/agx-rules-knowledge-suite/requirement-background.md`.
> Execute sequentially: K2-1 → K2-5. No parallel sub-agents. No A9 compute. Do not invent customer/company names.

**Goal:** Land P1 capability **K2 知识对象生命周期与质量治理** as a reusable A-layer spine: knowledge-object status machine (draft → pending_review → published → retired) + change trail, quality issue checks → issue list with handling status, optional idmapping hook, and a closed-loop e2e (ingest → quality → issues → review → publish/retire) with full audit trail.

**What K2 means (per suite plan):**
- Knowledge object lifecycle state machine + 变更追溯
- Quality checks: 标识关联、必填属性、关系完整性、重复、冲突、失效 → 问题清单 + 处理状态跟踪
- Link with `data_suite/idmapping/` for entity-level governance (主索引合并 / 冲突策略 / 快照回放)
- Review actions leave audit records (RBAC wiring deferred to admin slice / later; library exposes actor + action fields)
- Landing: primary package `agenticx/knowledge/lifecycle/` (knowledge-domain entity); thin re-exports / hooks from `agenticx/data_suite/governance/` as needed; admin-console「数据治理」pages only if a later slice explicitly scopes UI

**Assumptions (suite plan is capability-level; these make slices executable):**
1. Knowledge object is a generic entity record (`id`, `kind`, `attrs`, `relations`, `status`, `version`) — no industry ontology in trunk.
2. Status vocabulary matches requirement background: `draft` / `pending_review` / `published` / `retired` (已失效).
3. Persistence mirrors R1 `RuleFileStore` (JSON under resolve_store_dir / env / `.runtime/knowledge-lifecycle`).
4. Quality checkers are pure functions over object(s) + optional policy config; no LLM.
5. Idmapping integration is optional adapter (call merge/conflict surfaces), not a rewrite of `IdMappingEngine`.
6. Admin UI e2e is **out of K2-1…K2-4**; K2-5 may add README sample + library e2e only unless UI is explicitly added later (same discipline as K1-3: contract first).

**A/B boundary:**
- **In AgenticX (A):** `agenticx/knowledge/lifecycle/` model/store/quality/issues/audit; hooks to idmapping; synthetic fixtures under `tests/knowledge/lifecycle/`.
- **Out (B):** domain ontology instances, industry dictionaries, source adapters, Java delivery shells, project eval sets, real customer identifiers.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| K2-1 | `2026-10-29-agx-rules-knowledge-p1-k2-1-object-model.plan.md` | KnowledgeObject + status machine + KnowledgeObjectFileStore + unit tests green |
| K2-2 | `2026-10-29-agx-rules-knowledge-p1-k2-2-change-trail.plan.md` | Change/audit trail append + query + tests |
| K2-3 | `2026-10-29-agx-rules-knowledge-p1-k2-3-quality-checks.plan.md` | Six check kinds emit issues; policy-driven; tests |
| K2-4 | `2026-10-29-agx-rules-knowledge-p1-k2-4-issue-tracker.plan.md` | Issue list store + handling status transitions + tests |
| K2-5 | `2026-10-29-agx-rules-knowledge-p1-k2-5-idmap-e2e.plan.md` | Idmapping hook + closed-loop e2e + README sample; index complete |

## E2E gate (whole K2)

1. `pytest tests/knowledge/lifecycle/ -q` green.
2. Sample multi-object path: ingest drafts → run quality → open issues → resolve/waive → submit review → publish / retire, exits 0 with trail entries.
3. No real customer / company / proposal identifiers under `agenticx/knowledge/lifecycle/` or related fixtures.

## Branch

`feat/agx-rules-knowledge-p1-k2` from latest `main` (tip includes P0 `b7ff1e8c`).

## Status

- **Plans:** all K2 slices Done
- **Impl:** K2-1…K2-5 complete on `feat/agx-rules-knowledge-p1-k2` (PR #145)
