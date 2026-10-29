"""Tracked quality issue list with handling status."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field, replace
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Union

from agenticx.knowledge.lifecycle.model import utc_now_iso
from agenticx.knowledge.lifecycle.quality import QualityFinding
from agenticx.knowledge.lifecycle.store import resolve_store_dir


class IssueStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    WAIVED = "waived"


ALLOWED_ISSUE_TRANSITIONS: Dict[IssueStatus, Set[IssueStatus]] = {
    IssueStatus.OPEN: {IssueStatus.IN_PROGRESS, IssueStatus.RESOLVED, IssueStatus.WAIVED},
    IssueStatus.IN_PROGRESS: {IssueStatus.RESOLVED, IssueStatus.WAIVED, IssueStatus.OPEN},
    IssueStatus.RESOLVED: {IssueStatus.OPEN},
    IssueStatus.WAIVED: {IssueStatus.OPEN},
}


class IssueTransitionError(ValueError):
    """Illegal issue status transition."""


def fingerprint(object_id: str, code: str, message: str) -> str:
    raw = f"{object_id}|{code}|{message}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


@dataclass
class KnowledgeIssue:
    id: str
    object_id: str
    code: str
    severity: str
    status: IssueStatus = IssueStatus.OPEN
    message: str = ""
    detail: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    resolved_by: str = ""
    fingerprint: str = ""

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip() or str(uuid.uuid4())
        self.object_id = str(self.object_id or "").strip()
        if not self.object_id:
            raise ValueError("KnowledgeIssue.object_id is required")
        self.code = str(self.code or "").strip()
        self.severity = str(self.severity or "error")
        if isinstance(self.status, str):
            self.status = IssueStatus(self.status)
        self.message = str(self.message or "")
        self.detail = dict(self.detail or {})
        self.resolved_by = str(self.resolved_by or "")
        if not self.fingerprint:
            self.fingerprint = fingerprint(self.object_id, self.code, self.message)
        if not self.created_at:
            self.created_at = utc_now_iso()
        if not self.updated_at:
            self.updated_at = self.created_at

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "KnowledgeIssue":
        return cls(
            id=str(raw.get("id") or ""),
            object_id=str(raw.get("object_id") or ""),
            code=str(raw.get("code") or ""),
            severity=str(raw.get("severity") or "error"),
            status=IssueStatus(str(raw.get("status") or IssueStatus.OPEN.value)),
            message=str(raw.get("message") or ""),
            detail=dict(raw.get("detail") or {}),
            created_at=str(raw.get("created_at") or ""),
            updated_at=str(raw.get("updated_at") or ""),
            resolved_by=str(raw.get("resolved_by") or ""),
            fingerprint=str(raw.get("fingerprint") or ""),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "object_id": self.object_id,
            "code": self.code,
            "severity": self.severity,
            "status": self.status.value,
            "message": self.message,
            "detail": dict(self.detail),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "resolved_by": self.resolved_by,
            "fingerprint": self.fingerprint,
        }

    @classmethod
    def from_finding(cls, finding: QualityFinding) -> "KnowledgeIssue":
        return cls(
            id="",
            object_id=finding.object_id,
            code=finding.code,
            severity=finding.severity,
            message=finding.message,
            detail=dict(finding.detail),
        )


class IssueFileStore:
    """Persist knowledge quality issues in ``issues.json``."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "issues.json"
        self._issues: Dict[str, KnowledgeIssue] = {}
        self._load()

    def _load(self) -> None:
        self._issues.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("issues") or []:
            issue = KnowledgeIssue.from_dict(row)
            self._issues[issue.id] = issue

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"issues": [self._issues[k].to_dict() for k in sorted(self._issues)]}
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def open_from_findings(self, findings: Sequence[QualityFinding]) -> List[KnowledgeIssue]:
        """Open issues from findings; dedup open/in_progress by fingerprint."""
        openish = {
            i.fingerprint: i
            for i in self._issues.values()
            if i.status in {IssueStatus.OPEN, IssueStatus.IN_PROGRESS}
        }
        created: List[KnowledgeIssue] = []
        for f in findings:
            issue = KnowledgeIssue.from_finding(f)
            if issue.fingerprint in openish:
                continue
            # Also skip if same fingerprint already resolved/waived? Re-open only when not present.
            existing_any = next(
                (i for i in self._issues.values() if i.fingerprint == issue.fingerprint),
                None,
            )
            if existing_any and existing_any.status in {IssueStatus.OPEN, IssueStatus.IN_PROGRESS}:
                continue
            if existing_any and existing_any.status in {IssueStatus.RESOLVED, IssueStatus.WAIVED}:
                # Finding returned — reopen
                updated = replace(
                    existing_any,
                    status=IssueStatus.OPEN,
                    updated_at=utc_now_iso(),
                    resolved_by="",
                    message=issue.message,
                    detail=dict(issue.detail),
                    severity=issue.severity,
                )
                self._issues[updated.id] = updated
                created.append(updated)
                openish[updated.fingerprint] = updated
                continue
            self._issues[issue.id] = issue
            openish[issue.fingerprint] = issue
            created.append(issue)
        self._persist()
        return created

    def get_issue(self, issue_id: str) -> KnowledgeIssue:
        try:
            return self._issues[issue_id]
        except KeyError as e:
            raise KeyError(issue_id) from e

    def transition(
        self,
        issue_id: str,
        to: IssueStatus,
        *,
        actor: str = "",
    ) -> KnowledgeIssue:
        current = self.get_issue(issue_id)
        if to not in ALLOWED_ISSUE_TRANSITIONS.get(current.status, set()):
            raise IssueTransitionError(
                f"cannot transition issue {issue_id!r} from {current.status.value} to {to.value}"
            )
        now = utc_now_iso()
        resolved_by = current.resolved_by
        if to in {IssueStatus.RESOLVED, IssueStatus.WAIVED}:
            resolved_by = str(actor or resolved_by or "system")
        elif to is IssueStatus.OPEN:
            resolved_by = ""
        updated = replace(current, status=to, updated_at=now, resolved_by=resolved_by)
        self._issues[issue_id] = updated
        self._persist()
        return updated

    def list_issues(
        self,
        *,
        object_id: Optional[str] = None,
        status: Optional[IssueStatus] = None,
    ) -> List[KnowledgeIssue]:
        items = [self._issues[k] for k in sorted(self._issues)]
        if object_id is not None:
            items = [i for i in items if i.object_id == object_id]
        if status is not None:
            if isinstance(status, str):
                status = IssueStatus(status)
            items = [i for i in items if i.status is status]
        return items
