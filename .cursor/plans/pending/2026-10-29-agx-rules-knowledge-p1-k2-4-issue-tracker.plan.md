# AGX Rules & Knowledge P1 — K2-4 Issue list + handling status

> **Parent:** `.cursor/plans/pending/2026-10-29-agx-rules-knowledge-p1-k2-index.plan.md`
> **Depends on:** K2-3

**Goal:** Persist quality findings as a tracked issue list with handling status (open → in_progress → resolved | waived), so the 「问题清单」闭环 is library-complete before the publish e2e.

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/knowledge/lifecycle/issues.py` | KnowledgeIssue, IssueStatus, IssueFileStore, open_from_findings |
| `tests/knowledge/lifecycle/test_issue_tracker.py` | Open / transition / list filters / persist |

## Interfaces

```python
class IssueStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    WAIVED = "waived"

@dataclass
class KnowledgeIssue:
    id: str
    object_id: str
    code: str
    severity: str
    status: IssueStatus = IssueStatus.OPEN
    message: str = ""
    detail: dict = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    resolved_by: str = ""

class IssueFileStore:
    def open_from_findings(self, findings: list[QualityFinding]) -> list[KnowledgeIssue]: ...
    def transition(self, issue_id: str, to: IssueStatus, *, actor: str = "") -> KnowledgeIssue: ...
    def list_issues(self, *, object_id: str | None = None, status: IssueStatus | None = None) -> list[KnowledgeIssue]: ...
```

### Task 1

- [ ] Dedup open issues by (object_id, code, message fingerprint) on re-ingest.
- [ ] Commit: `feat(knowledge): knowledge quality issue tracker`

## Status

Pending.
