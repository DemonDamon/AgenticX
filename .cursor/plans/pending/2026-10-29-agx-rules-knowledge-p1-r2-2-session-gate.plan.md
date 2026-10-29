# AGX Rules & Knowledge P1 — R2-2 Session store + DisambiguationGate

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-r2-index.plan.md`
> **Depends on:** R2-1

**Goal:** Multi-turn disambiguation session (open → pending requests → apply responses → complete/cancel) with JSON file-store and a sync/async gate API parallel to ConfirmGate/ClarifyGate.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/runtime/disambiguation.py` | Extend with Session, FileStore, DisambiguationGate, SyncDisambiguationGate |
| `tests/runtime/disambiguation/test_session_gate.py` | Multi-turn open/answer/complete; persist reload |

## Interfaces

```python
class DisambiguationSessionStatus(str, Enum):
    OPEN = "open"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

@dataclass
class DisambiguationSession:
    id: str
    status: DisambiguationSessionStatus
    source: str                 # "rules.nl" | "retrieval.object" | ...
    pending: list[DisambiguationRequest]
    resolved: list[dict]        # [{request_id, response, ...}]
    slots: dict                 # accumulated field → value
    created_at: str
    updated_at: str
    meta: dict = field(default_factory=dict)

class DisambiguationFileStore:
    def create_session(...) -> DisambiguationSession: ...
    def get_session(session_id: str) -> DisambiguationSession: ...
    def upsert_session(session: DisambiguationSession) -> DisambiguationSession: ...
    def list_sessions(*, status=None, source=None) -> list[DisambiguationSession]: ...

class DisambiguationGate(ABC):
    async def request(self, req: DisambiguationRequest) -> DisambiguationResponse: ...

class SyncDisambiguationGate(DisambiguationGate):
    """Test/helper gate: resolver callable or scripted responses queue."""
    ...

class RecordingDisambiguationGate(DisambiguationGate):
    """Records requests; resolve via push_response(request_id, resp)."""
    ...
```

Env: `AGX_DISAMBIGUATION_STORE_DIR` else `.runtime/disambiguation`.

Helpers: `apply_response_to_session(session, resp) -> session` updates `slots` from selected candidate / free_text keyed by `req.field`.

### Task 1

- [ ] Session lifecycle + store persist/reload tests.
- [ ] Gate records request and returns pushed response; cancel path.
- [ ] Commit: `feat(runtime): disambiguation session store and gate`

## Status

Pending.
