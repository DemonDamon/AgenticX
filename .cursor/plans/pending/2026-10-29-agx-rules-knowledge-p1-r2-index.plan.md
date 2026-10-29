# AGX Rules & Knowledge Suite P1 — R2 Index (Disambiguation Confirm)

> **Parent roadmap:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md`
> **Depends on:** P0 R1+K1 on `main` (PR #144, sha `b7ff1e8c`); K2 merge tip `dce771f5` (PR #145). Requirement background: `docs/agx-rules-knowledge-suite/requirement-background.md`.
> Execute sequentially: R2-1 → R2-5. No parallel sub-agents. No A9 compute. Do not invent customer/company names.

**Goal:** Land P1 capability **R2 消歧确认交互模式** as a reusable A-layer protocol: extend the confirmation surface beyond high-risk boolean approve/reject to three generic modes — candidate selection, information supplement, conflict adjudication — shared by R1 NL→rule and retrieval object disambiguation, with multi-turn session state.

**What R2 means (per suite plan):**
- Confirm protocol extended to three modes: **候选选择** / **信息补充** / **冲突裁决**
- Same protocol used by R1 NL→rule ambiguities and retrieval object disambiguation
- Multi-turn disambiguation session state (file-store / memory-shaped), not only one-shot clarify
- Landing: `agenticx/runtime/disambiguation.py` (confirm-protocol extension sibling to `confirm.py` / `clarify.py`) + thin adapters under `agenticx/rules/` and `agenticx/retrieval/`
- Acceptance: rule-generation and object-retrieval paths both resolve ambiguity through one protocol

**Assumptions (suite plan is capability-level; these make slices executable):**
1. Boolean `ConfirmGate` stays unchanged for risk approve/reject; R2 adds a parallel structured protocol (does not break existing confirm callers).
2. `ClarifyGate` remains the open-ended UI transport; R2 models *what* to ask (mode + candidates/conflicts), not Desktop SSE wiring.
3. Session persistence mirrors R1/K2 file-store: JSON under `AGX_DISAMBIGUATION_STORE_DIR` / `.runtime/disambiguation`.
4. No LLM in unit tests — deterministic fixtures from NL templates and synthetic retrieval hits.
5. Admin / portal UI e2e is **out of R2-1…R2-5** (library protocol only). Admin choice-panel landed separately as R2 admin (PR #148).
6. agent_runtime deep integration (tool loop hooks) is optional thin helper in R2-5; full Desktop UI callback stays existing ClarifyGate.

**A/B boundary:**
- **In AgenticX (A):** disambiguation modes/request/response/session/gate; rules + retrieval adapters; synthetic fixtures under `tests/runtime/disambiguation/` (+ adapter tests).
- **Out (B):** domain lexicons, industry entity dictionaries, real customer identifiers, portal/admin chrome, project eval sets.

## Subplan order

| # | Path | Done when |
|---|------|-----------|
| R2-1 | `2026-10-29-agx-rules-knowledge-p1-r2-1-protocol.plan.md` | Modes + request/response model + unit tests green |
| R2-2 | `2026-10-29-agx-rules-knowledge-p1-r2-2-session-gate.plan.md` | Session store + DisambiguationGate + multi-turn tests |
| R2-3 | `2026-10-29-agx-rules-knowledge-p1-r2-3-rules-adapter.plan.md` | NlAmbiguity → protocol; apply resolutions → draft; tests |
| R2-4 | `2026-10-29-agx-rules-knowledge-p1-r2-4-retrieval-adapter.plan.md` | Object-hit disambiguation via same protocol; tests |
| R2-5 | `2026-10-29-agx-rules-knowledge-p1-r2-5-e2e.plan.md` | Dual-path e2e + README; index complete; admin UI via R2 admin PR #148 |

## E2E gate (whole R2)

1. `pytest tests/runtime/disambiguation/ tests/rules/test_nl_disambiguation.py tests/retrieval/test_object_disambiguation.py -q` green.
2. Sample: NL with ambiguities → candidate/supplement turns → resolved draft; retrieval multi-hit → conflict/candidate pick → single object id; both use same `DisambiguationRequest` types.
3. No real customer / company / proposal identifiers in new code or fixtures.

## Branch

`feat/agx-rules-knowledge-p1-r2` from latest `main` (tip ≥ `dce771f5`).

## Status

- **Plans:** all R2 slices Done
- **Impl:** R2-1…R2-5 merged via PR #146 (`2f31b32e`)
- **Admin UI:** Done via PR #148 (`44d6c050`) — `/admin/disambiguation` + shots 07–09
- **Portal choice-panel:** still optional / later if needed

