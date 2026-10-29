"""First-class KnowledgeObject entity: status machine, attrs, serialization."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set


class KnowledgeStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    PUBLISHED = "published"
    RETIRED = "retired"


ALLOWED_TRANSITIONS: Dict[KnowledgeStatus, Set[KnowledgeStatus]] = {
    KnowledgeStatus.DRAFT: {KnowledgeStatus.PENDING_REVIEW, KnowledgeStatus.RETIRED},
    KnowledgeStatus.PENDING_REVIEW: {
        KnowledgeStatus.PUBLISHED,
        KnowledgeStatus.DRAFT,
        KnowledgeStatus.RETIRED,
    },
    KnowledgeStatus.PUBLISHED: {KnowledgeStatus.RETIRED, KnowledgeStatus.DRAFT},
    KnowledgeStatus.RETIRED: {KnowledgeStatus.DRAFT},
}


class KnowledgeTransitionError(ValueError):
    """Illegal knowledge-object status transition."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class KnowledgeObject:
    id: str
    kind: str
    status: KnowledgeStatus = KnowledgeStatus.DRAFT
    version: int = 1
    attrs: Dict[str, Any] = field(default_factory=dict)
    relations: List[Dict[str, Any]] = field(default_factory=list)
    source_ids: List[str] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip()
        self.kind = str(self.kind or "").strip()
        if not self.id:
            raise ValueError("knowledge object.id is required")
        if not self.kind:
            raise ValueError("knowledge object.kind is required")
        if isinstance(self.status, str):
            self.status = KnowledgeStatus(self.status)
        self.version = int(self.version)
        if self.version < 1:
            raise ValueError("knowledge object.version must be >= 1")
        self.attrs = dict(self.attrs or {})
        self.relations = [dict(r) for r in (self.relations or [])]
        self.source_ids = [str(x) for x in (self.source_ids or [])]
        self.meta = dict(self.meta or {})
        if not self.created_at:
            self.created_at = utc_now_iso()
        if not self.updated_at:
            self.updated_at = self.created_at

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "KnowledgeObject":
        if not isinstance(raw, dict):
            raise ValueError("knowledge object must be a mapping")
        return cls(
            id=str(raw.get("id") or ""),
            kind=str(raw.get("kind") or ""),
            status=KnowledgeStatus(str(raw.get("status") or KnowledgeStatus.DRAFT.value)),
            version=int(raw.get("version") or 1),
            attrs=dict(raw.get("attrs") or {}),
            relations=list(raw.get("relations") or []),
            source_ids=list(raw.get("source_ids") or []),
            meta=dict(raw.get("meta") or {}),
            created_at=str(raw.get("created_at") or ""),
            updated_at=str(raw.get("updated_at") or ""),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status.value,
            "version": self.version,
            "attrs": dict(self.attrs),
            "relations": [dict(r) for r in self.relations],
            "source_ids": list(self.source_ids),
            "meta": dict(self.meta),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def can_transition(current: KnowledgeStatus, target: KnowledgeStatus) -> bool:
    return target in ALLOWED_TRANSITIONS.get(current, set())


def apply_transition(
    obj: KnowledgeObject,
    target: KnowledgeStatus,
    *,
    now: Optional[str] = None,
) -> KnowledgeObject:
    """Return a new KnowledgeObject after a legal status transition."""
    if not can_transition(obj.status, target):
        raise KnowledgeTransitionError(
            f"cannot transition knowledge object {obj.id!r} from {obj.status.value} to {target.value}"
        )
    stamp = now or utc_now_iso()
    return replace(obj, status=target, updated_at=stamp)
