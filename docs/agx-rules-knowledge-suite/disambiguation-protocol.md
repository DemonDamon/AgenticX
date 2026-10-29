# R2 Disambiguation Confirm Protocol

> Parent: `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-suite.plan.md` · P1 R2
> Code: `agenticx/runtime/disambiguation.py` · adapters: `agenticx/rules/disambiguation.py`, `agenticx/retrieval/disambiguation.py`

## Why

`agenticx/runtime/confirm.py` covers **boolean** high-risk approve/reject. R2 adds a structured confirm protocol for **ambiguity**: candidate pick, missing-info supplement, and conflict adjudication. Rules NL and retrieval object lookup share the same request/response types so agents do not reinvent per-domain UX.

## Modes

| Mode | Value | When |
|------|-------|------|
| 候选选择 | `candidate_select` | ≥1 candidate ids/labels; user picks subset |
| 信息补充 | `info_supplement` | Missing free-text slot (`allow_free_text=True`) |
| 冲突裁决 | `conflict_resolve` | Side-by-side conflicting values (+ optional candidate encodings) |

Boolean risk confirm and Desktop `ClarifyGate` transport remain unchanged. R2 models *what* to ask; UI callbacks can map requests onto clarify/choice panels later.

## Session

Multi-turn state: `DisambiguationSession` (`open` → `completed` / `cancelled`) with `pending` requests, `resolved` trail, and accumulated `slots`. Persistence: `AGX_DISAMBIGUATION_STORE_DIR` or `.runtime/disambiguation/sessions.json`.

## Adapters

- **Rules NL:** `NlAmbiguity` → requests; gate answers merge into text/lexicon and re-`draft_rule_from_nl`.
- **Retrieval:** near-score `ObjectHit` lists → `candidate_select`; multi-source attr maps → `conflict_resolve`.

## Admin / UI

**Deferred.** This slice ships library protocol + adapters + pytest e2e only. No admin-console / web-portal pages or HD shots in P1 R2. A later slice may add choice-panel UI similar to rule-governance.

## A/B

Trunk holds generic ids/labels/scores only. Domain lexicons and industry entity dictionaries stay project (B) config.
