# AGX Data Suite P2-A7-1 — Field Masking Engine

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a7-index.plan.md`

**Goal:** Config-driven field masking: sensitivity class + viewer role → strategy (full / partial / hash / drop).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/masking/__init__.py` | Exports |
| `agenticx/data_suite/masking/policy.py` | `FieldSensitivity`, `MaskStrategy`, `MaskingPolicy`, `load_masking_policy` |
| `agenticx/data_suite/masking/engine.py` | `MaskingEngine.apply(rows, *, role)` |
| `tests/data_suite/fixtures/sample_masking.yaml` | Sample policy |
| `tests/data_suite/test_masking_engine.py` | Apply / role matrix |

## Interfaces

```python
@dataclass(frozen=True)
class FieldRule:
    field: str
    sensitivity: str  # public|internal|confidential|restricted
    strategies: dict[str, str]  # role -> full|partial|hash|drop
    # missing role => default_strategy
    default_strategy: str = "full"

@dataclass(frozen=True)
class MaskingPolicy:
    id: str
    rules: list[FieldRule]

class MaskingEngine:
    def __init__(self, policy: MaskingPolicy) -> None: ...
    def apply(self, rows: list[dict], *, role: str) -> list[dict]:
        """Return deep-copied rows with field values masked. Unknown fields untouched."""
```

Strategies:
- `full`: unchanged
- `partial`: keep first/last char, middle `*` (phones/emails-friendly)
- `hash`: stable sha256 hex[:12]
- `drop`: set `None`

### Task 1

- [ ] Failing tests: load YAML; analyst sees partial phone; admin sees full; guest drops restricted.
- [ ] Implement policy + engine.
- [ ] Commit: `feat(data-suite): field masking engine by role and sensitivity`
