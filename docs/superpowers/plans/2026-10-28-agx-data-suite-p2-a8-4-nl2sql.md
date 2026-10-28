# AGX Data Suite P2-A8-4 — Read-only NL2SQL Agent Surface

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a8-index.plan.md`

**Goal:** NL2SQL-oriented tool wrapper that only runs SELECT-like queries on a Channel; write guards block mutations and dangerous builtins.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/managed/templates/data_suite/nl2sql.py` | `ReadOnlySqlExecutor`, `is_read_only_sql`, manifest stub builder |
| `tests/managed/templates/test_nl2sql.py` | SELECT ok; INSERT/UPDATE/DROP denied; bash_exec denied by guards |

## Interfaces

```python
def is_read_only_sql(sql: str) -> bool:
    """True for single SELECT/WITH…SELECT; False for writes/DDL/multi-statements."""

class ReadOnlySqlExecutor:
    def __init__(self, channel, *, write_guard: WriteGuardPolicy): ...
    def execute(self, sql: str, *, limit: int = 100) -> list[dict]:
        """Raise PermissionError if not read-only; else channel.query with limit."""

def build_nl2sql_manifest_stub(*, model: str = "openai/gpt-4o-mini") -> dict:
    """Minimal agx.agent/v1 manifest: custom data_suite.sql_query only; no bash_exec."""
```

Use FakeChannel from data_suite tests — no live warehouse. LLM text→SQL generation can stay stubbed (pass SQL string into tool); full LLM loop is optional follow-up.

### Task 1

- [ ] Failing tests for is_read_only_sql matrix + executor deny path.
- [ ] Implement + wire assert_read_only_tools on stub manifest.
- [ ] Commit: `feat(managed): read-only NL2SQL template surface`
