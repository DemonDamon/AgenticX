# AGX Rules & Knowledge P1 — R2-3 Rules NL → disambiguation adapter

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-r2-index.plan.md`
> **Depends on:** R2-1, R2-2; existing `agenticx/rules/nl.py`

**Goal:** Map `NlAmbiguity` lists into protocol requests; after user resolutions, re-draft / fill slots and produce a confirmable Rule draft. Does not replace `draft_rule_from_nl` — wraps it.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/rules/disambiguation.py` | `ambiguities_to_requests`, `apply_slots_to_nl`, `resolve_nl_draft` |
| `tests/rules/test_nl_disambiguation.py` | Missing object/threshold → requests → resolved draft |

## Interfaces

```python
def ambiguities_to_requests(
    ambiguities: list[NlAmbiguity],
    *,
    session_id: str = "",
    context: dict | None = None,
) -> list[DisambiguationRequest]:
    """candidate_select when candidates non-empty; else info_supplement."""

def resolve_nl_draft(
    text: str,
    *,
    lexicon: dict | None = None,
    slots: dict | None = None,
    gate: DisambiguationGate | None = None,
    store: DisambiguationFileStore | None = None,
) -> tuple[NlRuleDraft, DisambiguationSession | None]:
    """
    Draft once; if ambiguities, open session + emit requests (via gate if provided).
    If slots provided (prior answers), merge into a synthetic continuation NL / lexicon override and re-draft.
    """
```

Slot merge strategy (deterministic, no LLM): inject missing object/threshold/channel from `slots` into lexicon overrides or a rewritten template string used only for re-parse.

### Task 1

- [x] Ambiguity with candidates → `candidate_select` request.
- [x] Empty candidates → `info_supplement`.
- [x] Scripted gate answers → final draft with rule non-None.
- [x] Commit: `feat(rules): NL disambiguation adapter on R2 protocol`

## Status

Done on `feat/agx-rules-knowledge-p1-r2` (R2-3).
