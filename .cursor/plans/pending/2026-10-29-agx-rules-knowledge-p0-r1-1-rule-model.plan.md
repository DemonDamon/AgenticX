# AGX Rules & Knowledge P0 — R1-1 Rule entity model + store

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p0-index.plan.md`

**Goal:** Introduce the first-class Rule entity (CRUD, version, enable/disable, status machine, metadata) with JSON file-store persistence patterned after `agenticx/data_suite/store/file_store.py`.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/rules/__init__.py` | Export Rule, RuleStatus, RuleMeta, RuleFileStore, transition helpers |
| `agenticx/rules/model.py` | Dataclasses + status enum + allowed transitions |
| `agenticx/rules/store.py` | `RuleFileStore` → `rules.json` under resolve_store_dir |
| `tests/rules/__init__.py` | Package marker |
| `tests/rules/test_rule_model.py` | Status transitions, meta validation |
| `tests/rules/test_rule_store.py` | Upsert / list / get / version bump / persist reload |

## Interfaces

```python
class RuleStatus(str, Enum):
    DRAFT = "draft"
    PENDING = "pending"      # awaiting activation review
    ACTIVE = "active"
    DISABLED = "disabled"
    ARCHIVED = "archived"

ALLOWED_TRANSITIONS = {
    RuleStatus.DRAFT: {RuleStatus.PENDING, RuleStatus.ARCHIVED},
    RuleStatus.PENDING: {RuleStatus.ACTIVE, RuleStatus.DRAFT, RuleStatus.ARCHIVED},
    RuleStatus.ACTIVE: {RuleStatus.DISABLED, RuleStatus.ARCHIVED},
    RuleStatus.DISABLED: {RuleStatus.ACTIVE, RuleStatus.ARCHIVED},
    RuleStatus.ARCHIVED: set(),
}

@dataclass
class RuleMeta:
    scope: str = ""           # e.g. tenant/workspace label (generic)
    priority: int = 100
    trigger: str = "manual"   # manual|schedule|event
    depends_on: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)

@dataclass
class Rule:
    id: str
    name: str
    status: RuleStatus = RuleStatus.DRAFT
    version: int = 1
    enabled: bool = False
    body: dict = field(default_factory=dict)  # DSL payload (filled in R1-2)
    meta: RuleMeta = field(default_factory=RuleMeta)
    created_at: str = ""
    updated_at: str = ""

class RuleFileStore:
    def list_rules(self) -> list[Rule]: ...
    def get_rule(self, rule_id: str) -> Rule: ...
    def upsert_rule(self, rule: Rule, *, bump_version: bool = False) -> Rule: ...
    def transition(self, rule_id: str, to: RuleStatus) -> Rule: ...
    def set_enabled(self, rule_id: str, enabled: bool) -> Rule: ...
```

### Task 1

- [x] Failing tests: invalid transition raises; missing rule KeyError; empty store lists [].
- [x] Implement model + store; green tests (tmp_path persist/reload).
- [x] Commit: `feat(rules): rule entity model and file store`

## Status

Done on `feat/agx-rules-knowledge-p0`.
