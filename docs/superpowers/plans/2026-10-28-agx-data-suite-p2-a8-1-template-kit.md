# AGX Data Suite P2-A8-1 — Managed Template Kit

> **Parent:** `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a8-index.plan.md`

**Goal:** Shared A-layer helpers so Data Agent templates share schedule tick, webhook notify, and write-guard policy without customer IAM / lakehouse code.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/managed/templates/__init__.py` | Package export |
| `agenticx/managed/templates/data_suite/__init__.py` | Exports |
| `agenticx/managed/templates/data_suite/types.py` | `WebhookEvent`, `GovernanceTodo`, `WriteGuardPolicy` |
| `agenticx/managed/templates/data_suite/webhook.py` | `WebhookNotifier` + `FakeWebhookSink` |
| `agenticx/managed/templates/data_suite/write_guards.py` | `assert_read_only_tools(manifest)` / deny list |
| `agenticx/managed/templates/data_suite/schedule_tick.py` | `run_scheduled(callable, *, tick_id)` thin wrapper for tests |
| `tests/managed/templates/test_data_suite_kit.py` | Unit tests |

## Interfaces

```python
@dataclass(frozen=True)
class WebhookEvent:
    kind: str  # quality_alert | dict_drift | nl2sql_audit
    payload: dict

class FakeWebhookSink:
    events: list[WebhookEvent]
    def post(self, event: WebhookEvent) -> None: ...

class WebhookNotifier:
    def __init__(self, sink: FakeWebhookSink | Callable[[WebhookEvent], None]): ...
    def emit(self, kind: str, **payload) -> None: ...

@dataclass(frozen=True)
class WriteGuardPolicy:
    deny_tool_names: frozenset[str]  # e.g. bash_exec, file_write
    allow_prefixes: frozenset[str]   # e.g. data_suite.

def assert_read_only_tools(manifest: dict, policy: WriteGuardPolicy) -> None:
    """Raise ValueError if any enabled tool is denied."""
```

### Task 1

- [ ] Failing tests: FakeWebhookSink collects events; assert_read_only_tools rejects `bash_exec`.
- [ ] Implement kit modules.
- [ ] Commit: `feat(managed): data suite agent template kit (webhook + write guards)`
