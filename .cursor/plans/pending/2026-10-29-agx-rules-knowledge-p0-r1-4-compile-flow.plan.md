# AGX Rules & Knowledge P0 — R1-4 Compile rule DSL → flow

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p0-index.plan.md`

**Goal:** Compile a validated RuleBody into an AGX Flow / workflow_engine-friendly plan; keep an external-engine backend as a plugin stub (pluggable target).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/rules/compile.py` | `CompileBackend` protocol; `FlowCompileBackend`; `ExternalEngineBackend` stub; `compile_rule` |
| `tests/rules/test_compile_flow.py` | Active rule compiles to node list; disabled/draft refuses; external stub returns descriptor |

## Interfaces

```python
class CompileError(ValueError): ...

@dataclass
class CompiledPlan:
    backend: str
    rule_id: str
    nodes: list[dict]
    meta: dict = field(default_factory=dict)

class CompileBackend(Protocol):
    name: str
    def compile(self, rule: Rule) -> CompiledPlan: ...

def compile_rule(rule: Rule, backend: CompileBackend | None = None) -> CompiledPlan: ...
```

### Task 1

- [x] Default Flow backend maps trigger/condition/actions → ordered nodes.
- [x] Refuse non-active rules unless `force=True`.
- [x] Commit: `feat(rules): compile rule DSL to flow plan`

## Status

Done on `feat/agx-rules-knowledge-p0`.
