# AGX Rules & Knowledge Suite P0 — Index

> **Parent roadmap:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md`
> **Depends on:** Data Suite through P4 on `main` (PR #141/#143, sha ~9e450e2c). Related planning docs: PR #142.
> Execute sequentially: R1-1 → R1-5, then K1-1 → K1-3. No parallel sub-agents. No A9 compute.

**Goal:** Land P0 capability table items **R1 Rule Assets & Engine** (`agenticx/rules/`) and **K1 Evidence & Citation** (`agenticx/retrieval/`) as executable slices with focused pytest gates, so a sample NL rule can later run generate → confirm → store → compile → status, and every retrieval path carries provenance / evidence bundles.

**A/B boundary:**
- **In AgenticX (A):** `agenticx/rules/` (entity model, DSL, NL→rule, compile backends, admin data models); `agenticx/retrieval/` provenance + evidence bundle; shared confirm reuse via `agenticx/runtime/confirm.py`.
- **In AgenticX (example only):** synthetic sample rules / evidence fixtures under `tests/` and `examples/` (no real customer, company, or proposal names).
- **Out of AgenticX (B):** domain ontology instances, industry dictionaries, source-system adapters, Java delivery shells, project-specific eval sets.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| R1-1 | `2026-10-29-agx-rules-knowledge-p0-r1-1-rule-model.plan.md` | Rule entity + status machine + RuleFileStore + unit tests green |
| R1-2 | `2026-10-29-agx-rules-knowledge-p0-r1-2-rule-dsl.plan.md` | Rule DSL parse/validate + tests green |
| R1-3 | `2026-10-29-agx-rules-knowledge-p0-r1-3-nl-to-rule.plan.md` | NL→structured draft pipeline + confirm gate hook + tests |
| R1-4 | `2026-10-29-agx-rules-knowledge-p0-r1-4-compile-flow.plan.md` | DSL→Flow/workflow_engine compile + pluggable backend stub + tests |
| R1-5 | `2026-10-29-agx-rules-knowledge-p0-r1-5-admin-e2e.plan.md` | Lifecycle e2e + execution record model + README sample |
| K1-1 | `2026-10-29-agx-rules-knowledge-p0-k1-1-provenance.plan.md` | RetrievalResult provenance fields + tests |
| K1-2 | `2026-10-29-agx-rules-knowledge-p0-k1-2-evidence-bundle.plan.md` | EvidenceBundle assemble + conflict/missing hints + tests |
| K1-3 | `2026-10-29-agx-rules-knowledge-p0-k1-3-citation-ui.plan.md` | Citation/conflict view-model contract + portal stub notes |

## E2E gate (whole P0)

1. `pytest tests/rules/ -q` green.
2. `pytest tests/retrieval/test_provenance*.py tests/retrieval/test_evidence*.py -q` green (once K1 lands).
3. One sample rule path: create (DSL or NL draft) → validate → activate → compile stub → status update, exits 0.
4. No real customer / company / proposal identifiers under `agenticx/rules/`, `agenticx/retrieval/evidence*`, or related fixtures.

## Branch

`feat/agx-rules-knowledge-p0` from latest `main`.

## Status

- **Plans:** writing
- **Impl:** pending (R1-1… then serial)
