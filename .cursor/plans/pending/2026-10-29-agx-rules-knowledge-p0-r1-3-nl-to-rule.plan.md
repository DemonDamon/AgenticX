# AGX Rules & Knowledge P0 — R1-3 NL → rule draft pipeline

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p0-index.plan.md`

**Goal:** Skeleton NL→rule pipeline: intent classify → element extract → ambiguity candidates → structured Rule draft → validate → confirm gate hook (reuse `runtime/confirm.py` semantics without requiring LLM in unit tests).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/rules/nl.py` | `NlRuleRequest`, `NlRuleDraft`, `draft_rule_from_nl` (deterministic stub + hook points) |
| `agenticx/rules/intents.py` | Intent enum: create / modify / query / test_run |
| `tests/rules/test_nl_to_rule.py` | Fixture NL strings → draft; missing elements → candidates; validate before confirm |

## Interfaces

```python
class RuleIntent(str, Enum):
    CREATE = "create"
    MODIFY = "modify"
    QUERY = "query"
    TEST_RUN = "test_run"

@dataclass
class NlAmbiguity:
    field: str
    candidates: list[str]
    reason: str

@dataclass
class NlRuleDraft:
    intent: RuleIntent
    rule: Rule | None
    ambiguities: list[NlAmbiguity]
    confirm_context: dict   # risk / reason for confirm.py

def draft_rule_from_nl(text: str, *, lexicon: dict | None = None) -> NlRuleDraft: ...
```

### Task 1

- [ ] Deterministic extractor for structured NL templates (no network LLM in unit tests).
- [ ] Ambiguity list when object/threshold missing; confirm_context set.
- [ ] Commit: `feat(rules): NL to rule draft pipeline skeleton`

## Status

Pending
