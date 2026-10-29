# AGX Rules & Knowledge P0 — R1-5 Admin e2e + execution records

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p0-index.plan.md`

**Goal:** End-to-end lifecycle on file store: draft→pending→active→compile→execution record; document sample under `examples/rules/` (synthetic only). Admin UI pages deferred to notes (data model ready).

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/rules/execution.py` | ExecutionRecord model + ExecutionFileStore |
| `examples/rules/sample_threshold_rule.yaml` | Synthetic sample (Brand-A style naming only) |
| `examples/rules/run_lifecycle.py` | One-command lifecycle demo |
| `tests/rules/test_lifecycle_e2e.py` | Full path pytest gate |
| `agenticx/rules/README.md` | How to run sample; desensitize checklist |

## Interfaces

```python
@dataclass
class ExecutionRecord:
    id: str
    rule_id: str
    rule_version: int
    status: str   # queued|running|completed|failed|cancelled
    nodes: list[dict]
    error: str | None = None
    started_at: str = ""
    finished_at: str = ""
```

### Task 1

- [ ] E2E pytest green; `python -m examples.rules.run_lifecycle` exits 0.
- [ ] Mark index Status for R1 complete.
- [ ] Commit: `feat(rules): lifecycle e2e and execution records`

## Status

Pending
