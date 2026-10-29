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

**Done (P1 R2 admin).** Admin-console choice-panel at `/admin/disambiguation` covers `candidate_select` / `info_supplement` / `conflict_resolve` (PR #148, `44d6c050`). HD shots 07–09: `docs/agx-rules-knowledge-suite/e2e-shots/`. Library protocol + adapters remain the source of truth; UI maps requests onto the choice panel.

**Done (P1 R2 portal).** Web-portal Near surface at `/workspace/disambiguation` consumes **runtime** sessions (`.runtime/disambiguation` / `AGX_DISAMBIGUATION_RUNTIME_STORE_DIR`), not the admin JSON store. Same three modes; Brand-A fixtures; settings entry under General.

## A/B

Trunk holds generic ids/labels/scores only. Domain lexicons and industry entity dictionaries stay project (B) config.
