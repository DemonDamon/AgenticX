"""First-class Rule entity: status machine, metadata, serialization."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set


class RuleStatus(str, Enum):
    DRAFT = "draft"
    PENDING = "pending"
    ACTIVE = "active"
    DISABLED = "disabled"
    ARCHIVED = "archived"


ALLOWED_TRANSITIONS: Dict[RuleStatus, Set[RuleStatus]] = {
    RuleStatus.DRAFT: {RuleStatus.PENDING, RuleStatus.ARCHIVED},
    RuleStatus.PENDING: {RuleStatus.ACTIVE, RuleStatus.DRAFT, RuleStatus.ARCHIVED},
    RuleStatus.ACTIVE: {RuleStatus.DISABLED, RuleStatus.ARCHIVED},
    RuleStatus.DISABLED: {RuleStatus.ACTIVE, RuleStatus.ARCHIVED},
    RuleStatus.ARCHIVED: set(),
}


class RuleTransitionError(ValueError):
    """Illegal rule status transition."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class RuleMeta:
    scope: str = ""
    priority: int = 100
    trigger: str = "manual"
    depends_on: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.scope = str(self.scope or "")
        self.priority = int(self.priority)
        self.trigger = str(self.trigger or "manual").strip().lower() or "manual"
        if self.trigger not in {"manual", "schedule", "event"}:
            raise ValueError(f"invalid RuleMeta.trigger: {self.trigger!r}")
        self.depends_on = [str(x) for x in (self.depends_on or [])]
        self.tags = [str(x) for x in (self.tags or [])]

    @classmethod
    def from_dict(cls, raw: Optional[Dict[str, Any]]) -> "RuleMeta":
        data = dict(raw or {})
        return cls(
            scope=str(data.get("scope") or ""),
            priority=int(data.get("priority") if data.get("priority") is not None else 100),
            trigger=str(data.get("trigger") or "manual"),
            depends_on=list(data.get("depends_on") or []),
            tags=list(data.get("tags") or []),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Rule:
    id: str
    name: str
    status: RuleStatus = RuleStatus.DRAFT
    version: int = 1
    enabled: bool = False
    body: Dict[str, Any] = field(default_factory=dict)
    meta: RuleMeta = field(default_factory=RuleMeta)
    created_at: str = ""
    updated_at: str = ""

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip()
        self.name = str(self.name or "").strip()
        if not self.id:
            raise ValueError("rule.id is required")
        if not self.name:
            raise ValueError("rule.name is required")
        if isinstance(self.status, str):
            self.status = RuleStatus(self.status)
        self.version = int(self.version)
        if self.version < 1:
            raise ValueError("rule.version must be >= 1")
        self.enabled = bool(self.enabled)
        self.body = dict(self.body or {})
        if not isinstance(self.meta, RuleMeta):
            self.meta = RuleMeta.from_dict(self.meta)  # type: ignore[arg-type]
        # Active rules are enabled by default when constructed that way;
        # store layer keeps enabled in sync with transitions.
        if not self.created_at:
            self.created_at = utc_now_iso()
        if not self.updated_at:
            self.updated_at = self.created_at

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "Rule":
        if not isinstance(raw, dict):
            raise ValueError("rule must be a mapping")
        return cls(
            id=str(raw.get("id") or ""),
            name=str(raw.get("name") or ""),
            status=RuleStatus(str(raw.get("status") or RuleStatus.DRAFT.value)),
            version=int(raw.get("version") or 1),
            enabled=bool(raw.get("enabled", False)),
            body=dict(raw.get("body") or {}),
            meta=RuleMeta.from_dict(raw.get("meta") if isinstance(raw.get("meta"), dict) else {}),
            created_at=str(raw.get("created_at") or ""),
            updated_at=str(raw.get("updated_at") or ""),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status.value,
            "version": self.version,
            "enabled": self.enabled,
            "body": dict(self.body),
            "meta": self.meta.to_dict(),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def can_transition(current: RuleStatus, target: RuleStatus) -> bool:
    return target in ALLOWED_TRANSITIONS.get(current, set())


def apply_transition(rule: Rule, target: RuleStatus, *, now: Optional[str] = None) -> Rule:
    """Return a new Rule after a legal status transition."""
    if not can_transition(rule.status, target):
        raise RuleTransitionError(
            f"cannot transition rule {rule.id!r} from {rule.status.value} to {target.value}"
        )
    enabled = rule.enabled
    if target is RuleStatus.ACTIVE:
        enabled = True
    elif target in {RuleStatus.DISABLED, RuleStatus.ARCHIVED, RuleStatus.DRAFT, RuleStatus.PENDING}:
        # Only ACTIVE keeps enabled=True by default.
        if target is not RuleStatus.ACTIVE:
            enabled = False if target in {RuleStatus.DISABLED, RuleStatus.ARCHIVED} else rule.enabled
            if target is RuleStatus.DISABLED:
                enabled = False
            if target is RuleStatus.ARCHIVED:
                enabled = False
    stamp = now or utc_now_iso()
    return replace(rule, status=target, enabled=enabled, updated_at=stamp)
