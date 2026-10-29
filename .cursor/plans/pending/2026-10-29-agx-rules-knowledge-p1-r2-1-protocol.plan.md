# AGX Rules & Knowledge P1 — R2-1 Disambiguation protocol model

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-r2-index.plan.md`

**Goal:** Introduce the shared disambiguation protocol types: three modes, request/response/candidate/conflict dataclasses, validation helpers. Pure model — no I/O.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/runtime/disambiguation.py` | Modes, DisambiguationCandidate/Conflict/Request/Response, validate helpers |
| `tests/runtime/disambiguation/__init__.py` | Package marker |
| `tests/runtime/disambiguation/test_protocol.py` | Mode enum, validation, serialization round-trip |

## Interfaces

```python
class DisambiguationMode(str, Enum):
    CANDIDATE_SELECT = "candidate_select"   # 候选选择
    INFO_SUPPLEMENT = "info_supplement"     # 信息补充
    CONFLICT_RESOLVE = "conflict_resolve"   # 冲突裁决

@dataclass
class DisambiguationCandidate:
    id: str
    label: str
    score: float | None = None
    meta: dict = field(default_factory=dict)

@dataclass
class DisambiguationConflict:
    field: str
    values: list[Any]          # conflicting values side-by-side
    sources: list[str] = field(default_factory=list)
    reason: str = ""

@dataclass
class DisambiguationRequest:
    id: str
    mode: DisambiguationMode
    prompt: str
    field: str = ""            # which slot is ambiguous
    candidates: list[DisambiguationCandidate] = field(default_factory=list)
    conflicts: list[DisambiguationConflict] = field(default_factory=list)
    allow_free_text: bool = False
    context: dict = field(default_factory=dict)
    session_id: str = ""

@dataclass
class DisambiguationResponse:
    request_id: str
    selected_ids: list[str] = field(default_factory=list)
    free_text: str | None = None
    cancelled: bool = False
    meta: dict = field(default_factory=dict)

def validate_request(req: DisambiguationRequest) -> None: ...
def validate_response(req: DisambiguationRequest, resp: DisambiguationResponse) -> None: ...
def request_to_dict / request_from_dict / response_to_dict / response_from_dict: ...
```

### Validation rules

- `candidate_select`: ≥1 candidate; response must pick ≥1 `selected_ids` subset (unless cancelled).
- `info_supplement`: `allow_free_text=True` (default for this mode); response needs non-empty `free_text` (unless cancelled).
- `conflict_resolve`: ≥1 conflict; response picks winner via `selected_ids` (candidate ids encoding chosen value) or free_text when allowed.

### Task 1

- [ ] Failing tests: invalid mode payloads raise; good payloads serialize.
- [ ] Implement model + helpers; green tests.
- [ ] Commit: `feat(runtime): disambiguation confirm protocol model`

## Status

Pending.
