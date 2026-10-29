# AGX Rules & Knowledge P0 — R1-2 Rule DSL + validation

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p0-index.plan.md`

**Goal:** Declare the rule DSL shaped as data-object → trigger → condition → action → feedback, with parse/validate helpers (YAML/dict) and no engine side effects yet.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/rules/dsl.py` | RuleBody / Condition / Action dataclasses; `parse_rule_body`; `validate_rule_body` |
| `tests/rules/test_rule_dsl.py` | Valid minimal body; missing object/action fails; unknown op fails |
| `agenticx/rules/__init__.py` | Re-export DSL symbols |

## Interfaces

```python
class RuleDslError(ValueError): ...

@dataclass
class Condition:
    field: str
    op: str          # eq|ne|gt|gte|lt|lte|in|exists|and|or|not
    value: Any = None
    args: list[Condition] = field(default_factory=list)

@dataclass
class Action:
    type: str        # notify|invoke|set_status|emit_event
    target: str = ""
    params: dict = field(default_factory=dict)

@dataclass
class RuleBody:
    object: str                  # data object / entity type (generic id)
    trigger: dict                # {type: schedule|event|manual, ...}
    condition: Condition
    actions: list[Action]
    feedback: dict = field(default_factory=dict)  # result feedback channel

def parse_rule_body(raw: dict | str | Path) -> RuleBody: ...
def validate_rule_body(body: RuleBody) -> None:  # raises RuleDslError
```

### Task 1

- [x] Failing tests for missing object / empty actions / bad op.
- [x] Implement dsl.py; green tests; store can round-trip `Rule.body` as dict via `asdict`.
- [x] Commit: `feat(rules): rule DSL parse and validation`

## Status

Done on `feat/agx-rules-knowledge-p0`.
